// Underline tab styling for page-level tabs (detail pages). Pass to the
// shared <TabsList>/<TabsTrigger> via className. Scrolls sideways on phones
// instead of wrapping into a ragged block.

export const pageTabsList =
  "flex w-full items-stretch justify-start gap-0 overflow-x-auto rounded-none border-b border-[var(--line)] bg-transparent p-0 [scrollbar-width:none]";

export const pageTabsTrigger =
  "relative -mb-px shrink-0 whitespace-nowrap rounded-none border-b-2 border-transparent px-4 py-3 text-[15px] text-[var(--muted)] hover:text-[var(--ink)] data-[state=active]:border-[var(--accent)] data-[state=active]:bg-transparent data-[state=active]:text-[var(--ink)] data-[state=active]:shadow-none focus-visible:outline-offset-[-3px]";

/** Small count bubble after a tab label. */
export const tabCount = "ml-1.5 rounded-full bg-[var(--surface-2)] px-1.5 text-[13px] tnum text-[var(--muted)]";
