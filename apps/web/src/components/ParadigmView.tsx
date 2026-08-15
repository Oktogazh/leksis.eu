import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  blockCells,
  flatFormOrder,
  layoutView,
  mergeCellSpans,
  mergeParadigms,
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
import type { ResolvedParadigm } from "../lib/paradigms";
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
  mergeKey,
}: {
  table: ResolvedLayoutTable;
  /** What to draw in a cell. */
  cell: (address: LayoutAddress) => ReactNode;
  /** What to draw where the paradigm has no such cell. Defaults to an em dash. */
  empty?: ReactNode;
  /**
   * Identity of what fills a cell, for merging syncretic ones. Adjacent cells
   * returning the same non-undefined key are drawn as **one** spanned cell.
   *
   * It must identify the *form*, never its spelling: a form written
   * `Gender=Fem,Masc` covers both cells and is one answer, while two forms that
   * merely happen to agree are two answers that coincide, and a table that
   * spanned the second would assert a syncretism nobody declared. Omitted (the
   * designer's preview) means no merging at all.
   */
  mergeKey?: (address: LayoutAddress) => string | undefined;
}) {
  const depths = (count: number): number[] => Array.from({ length: count }, (_, i) => i);

  // Which cells merge into which rectangles. The arithmetic is `mergeCellSpans`
  // in the shared package, as all of this component's arithmetic is: a table a
  // reader sees should be checkable without a browser.
  const spans = mergeCellSpans(table.cells, (address) => mergeKey?.(address));

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
                {line.map((address, column) => {
                  const span = spans[row]?.[column];
                  // Covered by a merged cell that started above or to the left:
                  // the form is drawn once, spanning here.
                  if (span === "covered" || span === undefined) return null;
                  return (
                    <td
                      key={column}
                      colSpan={span.colSpan > 1 ? span.colSpan : undefined}
                      rowSpan={span.rowSpan > 1 ? span.rowSpan : undefined}
                      className="border px-2 py-1 align-top text-sm text-content"
                    >
                      {/* `undefined` is a cell the language says it has no form
                          for. It must not look like a cell nobody has filled in
                          yet — that distinction is the whole reason exclusions
                          exist, and the reason this is not simply blank. */}
                      {address === undefined
                        ? (empty ?? <span aria-hidden="true">—</span>)
                        : cell(address)}
                    </td>
                  );
                })}
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

/**
 * One form as this component handles it: the entry's own, or one a paradigm
 * produced.
 *
 * `generated` is the only thing a reader is told about provenance, and it is
 * told visually rather than in words — an italic and a tooltip. A derived form
 * is not a claim the entry's author made, and a dictionary that presented the
 * two identically would be putting words in their mouth.
 *
 * `id` identifies the *instance*, which is what lets syncretic cells merge:
 * one form spanning two cells is one object in both, where two forms that
 * happen to agree are two.
 */
interface DisplayForm extends EntryInflectedForm {
  generated: boolean;
  id: number;
}

/** The forms of an entry as a flat list — the fallback, and today's behaviour. */
function FlatForms({
  forms,
  lookup,
}: {
  forms: readonly DisplayForm[];
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
          <FormText form={form} />
        </li>
      ))}
    </ul>
  );
}

/** A form's spelling, marked as derived when a rule produced it. */
function FormText({ form }: { form: DisplayForm }) {
  const { t } = useTranslation();
  if (!form.generated) return <>{form.form}</>;
  return (
    <span className="italic" title={t("entry.formGenerated")}>
      {form.form}
    </span>
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
  lemma,
  forms,
  paradigms,
  lookup,
}: {
  grammar: Grammar | undefined;
  categories: readonly Tag[];
  /** The entry's canonical orthography — every rule's implicit starting point. */
  lemma: string;
  /** The forms the entry asserts itself. */
  forms: readonly EntryInflectedForm[];
  /** The language's rules, in precedence order. Empty until layer 5 reaches a language. */
  paradigms: readonly ResolvedParadigm[];
  lookup: ReadonlyMap<string, GrammarLabel>;
}) {
  const { t } = useTranslation();

  // Generation happens here, in the browser, from the records — the AppView's
  // own copy of the rules exists only so search can find an inflected form. The
  // two agree because they call one merger over one generator (invariant 6).
  //
  // Memoised because it is real work now: a dense paradigm is hundreds of cells
  // of regex matching, and the entry page re-renders for every piece of side
  // data it loads. The identity of `forms` and `paradigms` is stable across
  // those renders — both come from state that only a reload replaces.
  const all: DisplayForm[] = useMemo(
    () =>
      mergeParadigms(
        paradigms.map((paradigm) => ({
          id: paradigm.paradigmKey,
          rules: paradigm.record.rules,
          requires: paradigm.record.requires,
        })),
        { lemma, forms },
      ).forms.map((form, id) => ({
        tag: form.tag,
        form: form.form,
        generated: form.from !== undefined,
        id,
      })),
    [paradigms, lemma, forms],
  );
  // `missing` is deliberately dropped. A reader has no use for the news that a
  // principal part is absent — that note is written for contributors, in the
  // rule author's own language, and the language dashboard's queue is where it
  // belongs.

  if (all.length === 0) return null;

  const view = layoutView(grammar, categories, all);
  if (view.blocks.length === 0 || !view.filled) {
    return <FlatForms forms={flatFormOrder(grammar ?? {}, categories, all)} lookup={lookup} />;
  }

  /**
   * The forms in one cell, with the entry's own winning it.
   *
   * `mergeParadigms` already settles the case where an asserted form and a
   * generated one carry the *same* address. This settles the other one, which
   * only a layout can see: a form the entry asserts at a more specific address
   * lands in the same cell as a generated one by containment, and §1.3's
   * precedence says the author's word wins. Dropping the generated form rather
   * than printing both is what keeps a cell one answer.
   */
  const held = (address: LayoutAddress): readonly DisplayForm[] | undefined => {
    const there = view.placed.get(address.key);
    if (there === undefined) return undefined;
    const asserted = there.filter((form) => !form.generated);
    return asserted.length > 0 ? asserted : there;
  };
  // A block none of whose cells hold a form is not drawn — but generation is
  // exactly what makes an empty table stop being empty, so a block the rules
  // fill is now drawn where before layer 5 it was not (ADR-0009 predicted this
  // revision).
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
    // Several forms genuinely sharing one cell are printed as they were
    // written. What is *not* printed twice is one form spanning several cells:
    // that is the same object in each of them, and `mergeKey` below merges
    // those into a single spanned cell instead.
    return there.map((form, i) => (
      <span key={form.id}>
        {i > 0 ? ", " : ""}
        <FormText form={form} />
      </span>
    ));
  };

  /**
   * A cell's identity for merging: the forms in it, by instance.
   *
   * Two adjacent cells share a key only when they hold literally the same form
   * object, which happens exactly when one form's address spanned both — a
   * multivalue coordinate, the settled spelling of syncretism. Two cells whose
   * forms merely happen to be spelled alike are different objects and stay
   * apart, because a table that merged them would assert a syncretism the
   * language never declared.
   */
  const mergeKey = (address: LayoutAddress): string | undefined => {
    const there = held(address);
    return there === undefined ? undefined : there.map((form) => form.id).join("+");
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
        mergeKey={mergeKey}
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
