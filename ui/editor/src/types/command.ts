// A command: an entry of the command catalogue (resources/symbols/command-catalogue.json, handed to the kernel when
// the editor starts), which the toolbar shows and inserts and the candidates offer. The editor makes a few of its
// own the same way (a matrix of a chosen size, a Greek letter typed after Ctrl+G).
export type { CommandCategory } from "@app/kernel/latex/command-types.ts";
export type { KernelCompletionRecord as Command } from "@app/kernel/kernel/host.ts";

export interface CommandUsage {
  commandId: string;
  useCount: number;
  lastUsedAt: number;
  recentUses: number[];
  acceptedPrefixes: Record<string, number>;
  contextCounts: Record<string, number>;
  pinned: boolean;
}

export type CommandSource = "candidate" | "toolbar" | "history" | "shortcut";
