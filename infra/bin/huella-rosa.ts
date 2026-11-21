#!/usr/bin/env node
import { App, Tags } from "aws-cdk-lib";
import { HuellaRosaStack } from "../lib/huella-rosa-stack";

const app = new App();
new HuellaRosaStack(app, "HuellaRosaStack", {
  env: { account: "888577060863", region: "us-east-1" },
  description: "Huella Rosa demo: one EC2 instance (Docker) behind a Cloudflare Tunnel, S3 for form photos, Textract.",
});
Tags.of(app).add("Project", "huella-rosa");
