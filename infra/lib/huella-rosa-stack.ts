import { CfnOutput, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

/** SecureString created outside the stack (see docs/DEPLOY.md); never stored in the template. */
export const TUNNEL_TOKEN_PARAMETER = "/huella-rosa/tunnel-token";
const REPO_URL = "https://github.com/JoryerJL/huella-rosa";
const REPO_BRANCH = "deploy";
const APP_DIR = "/opt/huella-rosa";

/**
 * Demo deployment: one Graviton instance running docker-compose.prod.yml (app + Valkey + cloudflared).
 * No inbound traffic at all: users arrive through the Cloudflare Tunnel, operators through SSM.
 */
export class HuellaRosaStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // One public subnet, no NAT gateway: the instance only needs outbound internet.
    const vpc = new ec2.Vpc(this, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.42.0.0/16"),
      availabilityZones: ["us-east-1a"],
      natGateways: 0,
      subnetConfiguration: [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });

    const securityGroup = new ec2.SecurityGroup(this, "AppSecurityGroup", {
      vpc,
      description: "Huella Rosa: no inbound rules, access via SSM Session Manager only",
      allowAllOutbound: true,
    });

    // Form photos: private, encrypted, removed together with the stack.
    const bucket = new s3.Bucket(this, "FormsBucket", {
      bucketName: `huella-rosa-forms-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const role = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: "Huella Rosa instance: forms bucket, Textract AnalyzeDocument, SSM",
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")],
    });
    bucket.grantRead(role);
    bucket.grantPut(role);
    bucket.grantDelete(role);
    role.addToPolicy(new iam.PolicyStatement({ actions: ["textract:AnalyzeDocument"], resources: ["*"] }));
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [this.formatArn({ service: "ssm", resource: "parameter", resourceName: TUNNEL_TOKEN_PARAMETER.slice(1) })],
      }),
    );

    const userData = ec2.UserData.forLinux();
    userData.addCommands(...bootstrapScript(bucket.bucketName, this.region));

    const instance = new ec2.Instance(this, "AppInstance", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      associatePublicIpAddress: true,
      securityGroup,
      role,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      blockDevices: [
        { deviceName: "/dev/xvda", volume: ec2.BlockDeviceVolume.ebs(20, { volumeType: ec2.EbsDeviceVolumeType.GP3, encrypted: true }) },
      ],
      // IMDSv2 only. Containers sit one network hop behind the host and need IMDS for the instance-profile credentials.
      httpEndpoint: true,
      httpTokens: ec2.HttpTokens.REQUIRED,
      httpPutResponseHopLimit: 2,
      userData,
      userDataCausesReplacement: true,
    });

    new CfnOutput(this, "InstanceId", { value: instance.instanceId });
    new CfnOutput(this, "BucketName", { value: bucket.bucketName });
  }
}

/** First-boot script: Docker + compose, clone the deploy branch, write .env files, start the stack. */
function bootstrapScript(bucketName: string, region: string): string[] {
  return [
    "set -euo pipefail",
    "exec > >(tee -a /var/log/huella-rosa-bootstrap.log) 2>&1",
    // 2 GB swap: t4g.small has 2 GB RAM and the image build runs npm + vite.
    "if [ ! -f /swapfile ]; then dd if=/dev/zero of=/swapfile bs=1M count=2048 && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap defaults 0 0' >> /etc/fstab; fi",
    "dnf install -y docker git jq",
    "systemctl enable --now docker",
    "PLUGINS=/usr/local/lib/docker/cli-plugins && mkdir -p $PLUGINS",
    "COMPOSE_TAG=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | jq -r .tag_name)",
    'curl -fsSL -o $PLUGINS/docker-compose "https://github.com/docker/compose/releases/download/${COMPOSE_TAG}/docker-compose-linux-aarch64"',
    "BUILDX_TAG=$(curl -fsSL https://api.github.com/repos/docker/buildx/releases/latest | jq -r .tag_name)",
    'curl -fsSL -o $PLUGINS/docker-buildx "https://github.com/docker/buildx/releases/download/${BUILDX_TAG}/buildx-${BUILDX_TAG}.linux-arm64"',
    "chmod +x $PLUGINS/docker-compose $PLUGINS/docker-buildx",
    "docker compose version && docker buildx version",
    `[ -d ${APP_DIR}/.git ] || git clone --branch ${REPO_BRANCH} --depth 1 ${REPO_URL} ${APP_DIR}`,
    `cd ${APP_DIR}`,
    "umask 077",
    `printf '%s\\n' OCR_MODE=textract STORAGE_MODE=s3 S3_BUCKET=${bucketName} AWS_REGION=${region} PORT=3001 > .env`,
    // The token is written straight to a 0600 file; it is never echoed or traced.
    `TOKEN=$(aws ssm get-parameter --region ${region} --name ${TUNNEL_TOKEN_PARAMETER} --with-decryption --query Parameter.Value --output text)`,
    `printf 'TUNNEL_TOKEN=%s\\n' "$TOKEN" > .env.tunnel && unset TOKEN`,
    "chmod 600 .env .env.tunnel",
    "docker compose -f docker-compose.prod.yml up -d --build",
    'echo "huella-rosa bootstrap done"',
  ];
}
