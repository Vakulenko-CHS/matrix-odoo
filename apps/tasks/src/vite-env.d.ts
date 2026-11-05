/// <reference types="vite/client" />

declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare module "../../../dev/ports.json" {
  const ports: { spec: number; beds: number; tasks: number };
  export default ports;
}
