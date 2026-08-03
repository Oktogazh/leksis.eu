import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  blockCells,
  flatFormOrder,
  layoutView,
  type EntryInflectedForm,
  type Grammar,
  type GrammarLabel,
  type LayoutAddress,
  type ResolvedLayoutBlock,
  type ResolvedLayoutList,
  type ResolvedLayoutTable,
  type ResolvedTagPart,
  type Tag,
} from "@leksis/types";
import { TagLabel } from "./EntryPreview";

// Drawing a resolved layout — shared by the reader's paradigm and the layout
// designer's grid.
//
// The two differ only in what a cell holds: a reader sees the form, a designer
// sees the form's identifier and can click it. Everything else — nested headers,
// their spans, the caption, the scroll box — is identical, and building it twice
// is how the designer's preview would come to disagree with the page it
// previews. So the structure lives here and the cell is a render prop.
//
// No arithmetic happens in this file. Which cells exist, in what order, with
// which headers spanning what, is `resolveLayout`'s answer in packages/types;
// here it is only drawn.

/** A block's caption: its pinned constants, resolved to the language's labels. */
export function BlockCaption({ caption }: { caption: ResolvedTagPart[] }) {
  if (caption.length === 0) return null;
  return (
    <p className="mb-1 text-xs font-medium text-content">
      {caption.map((part, i) => (
        <span key={i} className={part.bound ? undefined : "font-mono text-content-subtle"}>
          {i > 0 ? " " : ""}
          {part.label?.short ?? part.label?.long ?? part.verbatim}
        </span>
      ))}
    </p>
  );
}

const shown = (label: GrammarLabel): string => label.short ?? label.long;

/**
 * A resolved table. Each header carries the line it starts at and how many it
 * spans, computed by the resolver from the lines that survived exclusion — so a
 * dropped line shrinks the span above it without this component knowing why.
 */
export function ParadigmTable({
  table,
  cell,
  empty,
}: {
  table: ResolvedLayoutTable;
  /** What to draw in a cell. */
  cell: (address: LayoutAddress) => ReactNode;
  /** What to draw where the paradigm has no such cell. Defaults to an em dash. */
  empty?: ReactNode;
}) {
  const depths = (count: number): number[] => Array.from({ length: count }, (_, i) => i);
  return (
    <div>
      <BlockCaption caption={table.caption} />
      {/* A fifteen-case declension is not a narrow table: it scrolls in its own
          box rather than pushing the page sideways. */}
      <div className="overflow-x-auto">
        <table className="border-collapse text-left">
          <thead>
            {depths(table.columnAxes.length).map((depth) => (
              <tr key={depth}>
                {table.rowAxes.length > 0 && <th colSpan={table.rowAxes.length} />}
                {table.columnHeaders
                  .filter((header) => header.depth === depth)
                  .map((header, i) => (
                    <th
                      key={i}
                      colSpan={header.span}
                      scope="col"
                      title={header.value.label.long}
                      className="border px-2 py-1 text-xs font-medium text-content"
                    >
                      {shown(header.value.label)}
                    </th>
                  ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.cells.map((line, row) => (
              <tr key={row}>
                {table.rowHeaders
                  .filter((header) => header.start === row)
                  .map((header, i) => (
                    <th
                      key={i}
                      rowSpan={header.span}
                      scope="row"
                      title={header.value.label.long}
                      className="border px-2 py-1 align-top text-xs font-medium text-content"
                    >
                      {shown(header.value.label)}
                    </th>
                  ))}
                {line.map((address, column) => (
                  <td
                    key={column}
                    className="border px-2 py-1 align-top text-sm text-content"
                  >
                    {/* `undefined` is a cell the language says it has no form
                        for. It must not look like a cell nobody has filled in
                        yet — that distinction is the whole reason exclusions
                        exist, and the reason this is not simply blank. */}
                    {address === undefined ? (empty ?? <span aria-hidden="true">—</span>) : cell(address)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A resolved list block: addresses in the order the language prints them. */
export function ParadigmList({
  list,
  item,
  skip,
}: {
  list: ResolvedLayoutList;
  item: (address: LayoutAddress) => ReactNode;
  /**
   * Leave an address out. The designer shows every one it declared; a reader is
   * shown the ones that have a form, since a label with nothing beside it in a
   * run-in line is noise rather than information.
   */
  skip?: (address: LayoutAddress) => boolean;
}) {
  const { t } = useTranslation();
  const items = list.items.filter((address) => skip?.(address) !== true);
  if (items.length === 0) {
    return (
      <div>
        <BlockCaption caption={list.caption} />
        <p className="text-sm text-content-muted">{t("grammar.l4NoItems")}</p>
      </div>
    );
  }
  return (
    <div>
      <BlockCaption caption={list.caption} />
      <ul className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        {items.map((address, i) => (
          <li key={i}>{item(address)}</li>
        ))}
      </ul>
    </div>
  );
}

/** The forms of an entry as a flat list — the fallback, and today's behaviour. */
function FlatForms({
  forms,
  lookup,
}: {
  forms: readonly EntryInflectedForm[];
  lookup: ReadonlyMap<string, GrammarLabel>;
}) {
  const { t } = useTranslation();
  return (
    <ul
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
      aria-label={t("entry.otherFormsLabel")}
    >
      {forms.map((form, i) => (
        <li key={i} className="text-content">
          <span className="mr-1 font-mono text-xs text-content-muted">
            <TagLabel tag={form.tag} lookup={lookup} />
          </span>
          {form.form}
        </li>
      ))}
    </ul>
  );
}

/**
 * An entry's other forms, laid out the way its language says to.
 *
 * This is where the arc's promise lands: opening an entry **hydrates it with
 * language-level knowledge** and its forms arrive in a grid instead of a queue.
 * Everything it decides is decided by `layoutView` in the shared package; what is
 * left here is presentation, and one honest distinction the design note insists
 * on — a cell the language says **cannot exist** must not look like a cell
 * **nobody has filled in**.
 *
 * The degradation chain is total and ends where the arc started: no language
 * record, no grammar, no layout for this category, or a layout nothing has filled
 * → the flat list, ordered by the axes where they exist. Nothing is ever dropped:
 * a form addressing no cell is printed below the blocks, which is the failure
 * layer 5 will lean on when a generated cell and a hand-entered form disagree.
 */
export function EntryParadigm({
  grammar,
  categories,
  forms,
  lookup,
}: {
  grammar: Grammar | undefined;
  categories: readonly Tag[];
  forms: readonly EntryInflectedForm[];
  lookup: ReadonlyMap<string, GrammarLabel>;
}) {
  const { t } = useTranslation();
  if (forms.length === 0) return null;

  const view = layoutView(grammar, categories, forms);
  if (view.blocks.length === 0 || !view.filled) {
    return <FlatForms forms={flatFormOrder(grammar ?? {}, categories, forms)} lookup={lookup} />;
  }

  const held = (address: LayoutAddress): readonly EntryInflectedForm[] | undefined =>
    view.placed.get(address.key);
  // A block none of whose cells hold a form is not drawn. With no rules behind
  // the layout yet, an empty grid would be a promise the entry cannot keep —
  // revisit at layer 5, where generation fills what nobody entered.
  const drawn = view.blocks.filter((block) => blockCells(block).some((cell) => held(cell)));
  const marked = drawn.filter((block) => block.summary);
  const inline = marked.length > 0 ? marked : drawn;
  const behind = marked.length > 0 ? drawn.filter((block) => !block.summary) : [];

  const cellText = (address: LayoutAddress): ReactNode => {
    const there = held(address);
    if (there === undefined) {
      return (
        <>
          <span aria-hidden="true" className="text-content-subtle">
            ·
          </span>
          <span className="sr-only">{t("entry.formUnknown")}</span>
        </>
      );
    }
    // Several forms in one cell are printed as they were written. Merging
    // syncretic cells is layer 5's, where a generator knows they are the same
    // form rather than two answers to one question.
    return there.map((form) => form.form).join(", ");
  };

  const block = (resolved: ResolvedLayoutBlock, key: number): ReactNode =>
    resolved.kind === "list" ? (
      <ParadigmList
        key={key}
        list={resolved}
        skip={(address) => held(address) === undefined}
        item={(address) => (
          <>
            <span className="mr-1 font-mono text-xs text-content-muted">
              <TagLabel tag={address.tag} lookup={lookup} />
            </span>
            <span className="text-content">{cellText(address)}</span>
          </>
        )}
      />
    ) : (
      <ParadigmTable
        key={key}
        table={resolved}
        cell={cellText}
        empty={
          <>
            <span aria-hidden="true" className="text-content-subtle">
              —
            </span>
            <span className="sr-only">{t("entry.formNone")}</span>
          </>
        }
      />
    );

  return (
    <div aria-label={t("entry.paradigmLabel")}>
      <div className="space-y-3">{inline.map(block)}</div>
      {behind.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-primary hover:text-primary-hover">
            {t("entry.fullParadigm")}
          </summary>
          <div className="mt-2 space-y-3">{behind.map(block)}</div>
        </details>
      )}
      {/* Addressing no declared cell is not a reason to disappear. */}
      {view.leftover.length > 0 && (
        <div className="mt-2">
          <FlatForms forms={view.leftover} lookup={lookup} />
        </div>
      )}
    </div>
  );
}
