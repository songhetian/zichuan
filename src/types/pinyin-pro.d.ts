declare module "pinyin-pro" {
  export interface PinyinOptions {
    toneType?: "symbol" | "none" | "num";
    type?: "string" | "array";
    separator?: string;
    pattern?: "pinyin" | "initial" | "final" | "num";
    nonZh?: "consecutive" | "spread" | "removed";
    multiple?: boolean;
  }

  export function pinyin(text: string, options?: PinyinOptions): string | string[];

  export default pinyin;
}
