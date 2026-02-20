import type { SerializableTerminal } from "@/components/tool-ui/terminal";

export type TerminalSession = SerializableTerminal & {
  traceId?: string;
};
