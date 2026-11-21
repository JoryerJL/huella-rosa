import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AnalyzeDocumentCommand, TextractClient } from "@aws-sdk/client-textract";
import { env } from "../env";
import type { Template } from "../templates";
import { emptyExtraction, sanitizeExtraction, type Extraction } from "./fields";
import { mapTextractBlocks } from "./textractMapping";

// Form reading by OCR_MODE (SPEC 6.4 item 2). It only proposes values of the template fields;
// a person confirms every value with the photo in view. No generative model is involved.

export interface OcrInput {
  bytes: Uint8Array;
  originalName: string;
  template: Template;
}

export type OcrReader = (input: OcrInput) => Promise<Extraction>;

const SAMPLES_DIR = fileURLToPath(new URL("../../../../datos-ficticios/formatos/", import.meta.url));

/** "formato-01.svg", "IMG formato-03 (1).jpg" -> "formato-03". */
export function sampleNameFor(originalName: string): string | null {
  const m = originalName.toLowerCase().match(/formato-(\d{2})/);
  return m ? `formato-${m[1]}` : null;
}

/** Demo mode: the expected reading of a fictitious sample form, matched by file name. */
export async function readMock({ originalName, template }: OcrInput, dir = SAMPLES_DIR): Promise<Extraction> {
  const sample = sampleNameFor(originalName);
  if (!sample) return emptyExtraction(template);
  try {
    const raw = JSON.parse(await readFile(`${dir}${sample}.json`, "utf8")) as { templateId?: string; fields?: unknown };
    if (raw.templateId !== template.id) return emptyExtraction(template);
    return { ...emptyExtraction(template), ...sanitizeExtraction(raw.fields, template) };
  } catch {
    return emptyExtraction(template);
  }
}

let textract: TextractClient | null = null;

/** AWS Textract AnalyzeDocument with FORMS. Only used when OCR_MODE=textract. */
export async function readTextract({ bytes, template }: OcrInput): Promise<Extraction> {
  textract ??= new TextractClient({ region: env.awsRegion });
  const res = await textract.send(new AnalyzeDocumentCommand({ Document: { Bytes: bytes }, FeatureTypes: ["FORMS"] }));
  return { ...emptyExtraction(template), ...mapTextractBlocks(res.Blocks ?? [], template) };
}

export function ocrReader(): OcrReader {
  return env.ocrMode === "textract" ? readTextract : (input) => readMock(input);
}
