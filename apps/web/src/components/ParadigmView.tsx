import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  blockCells,
  flatFormOrder,
  formatTagVerbatim,
  layoutView,
  mergeCellSpans,
  mergeParadigms,
  type EntryInflectedForm,
  type Grammar,
  type GrammarLabel,
  type LayoutAddress,
  type LayoutCoord,
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
 * The two things a contributor can do about a cell nothing fills — offered
 * side by side, because which one is right is the distinction this layer most
 * needs a reader to understand.
 *
 * An **irregular** form belongs to the word: it goes in the entry, where it
 * wins its cell over anything the rules generate. A **regular** one belongs to
 * the language: it goes in a rule, and fills that cell for every word of the
 * category at once. Offering only the first would leave every contributor
 * hand-writing a paradigm the language could generate; offering only the second
 * would invite them to bend the language's rules around one irregular word.
 *
 * Deliberately absent: a third option saying this word simply *has* no such
 * form. Per-lexeme defectiveness has no shape in the lexicon yet, and guessing
 * one here would be answering an open question in a popover.
 */
function EmptyCellDoor({
  address,
  onEditRules,
  onAddForm,
  label,
}: {
  address: LayoutAddress;
  onEditRules?: (coords: LayoutCoord[]) => void;
  onAddForm?: () => void;
  label: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="rounded px-1 hover:bg-black/5"
      >
        {label}
      </button>
      {open && (
        <>
          {/* Clicking anywhere else closes it — a popover in a table cell has
              no room for a dismiss control. */}
          <span
            className="fixed inset-0 z-10 block cursor-default"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <span className="absolute left-0 top-full z-20 mt-1 block w-64 rounded-lg border bg-surface p-3 text-left shadow-lg">
            <span className="block text-xs font-medium text-content">
              {t("entry.cellDoorTitle")}
            </span>
            <span className="mt-1 block font-mono text-xs text-content-subtle">
              {formatTagVerbatim(address.tag)}
            </span>
            {onAddForm !== undefined && (
              <span className="mt-3 block">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onAddForm();
                  }}
                  className="text-sm font-medium text-primary hover:text-primary-hover"
                >
                  {t("entry.cellDoorOwnForm")}
                </button>
                <span className="mt-0.5 block text-xs text-content-subtle">
                  {t("entry.cellDoorOwnFormHint")}
                </span>
              </span>
            )}
            {onEditRules !== undefined && (
              <span className="mt-3 block border-t pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onEditRules(address.coords);
                  }}
                  className="text-sm font-medium text-primary hover:text-primary-hover"
                >
                  {t("entry.cellDoorRules")}
                </button>
                <span className="mt-0.5 block text-xs text-content-subtle">
                  {t("entry.cellDoorRulesHint")}
                </span>
              </span>
            )}
          </span>
        </>
      )}
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
  onEditRules,
  onAddForm,
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
  /**
   * The empty-cell door, both halves. Absent — logged out, or a preview — and
   * this component is exactly the reader it was before layer 5: an unfilled
   * cell is a dot and nothing more.
   *
   * Only an **unfilled** cell opens it. A cell the language says cannot exist
   * offers nothing, because the two must stay distinguishable and inviting
   * somebody to fill an impossible cell is the fastest way to collapse them.
   */
  onEditRules?: (coords: LayoutCoord[]) => void;
  onAddForm?: () => void;
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
      const empty = (
        <>
          <span aria-hidden="true" className="text-content-subtle">
            ·
          </span>
          <span className="sr-only">{t("entry.formUnknown")}</span>
        </>
      );
      if (onEditRules === undefined && onAddForm === undefined) return empty;
      return (
        <EmptyCellDoor
          address={address}
          onEditRules={onEditRules}
          onAddForm={onAddForm}
          label={empty}
        />
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
      {/* A legend per group of blocks, each beside the blocks it explains.
          One legend for the whole paradigm would sit outside the disclosure and
          describe an em dash the reader cannot see until they open it — which is
          the same mistake as explaining a convention the paradigm never uses. */}
      <ParadigmLegend blocks={inline} held={held} />
      {behind.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-primary hover:text-primary-hover">
            {t("entry.fullParadigm")}
          </summary>
          <div className="mt-2 space-y-3">{behind.map(block)}</div>
          <ParadigmLegend blocks={behind} held={held} />
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

/**
 * What the table's three conventions mean, printed under it.
 *
 * The distinctions this layer exists to preserve — derived from a rule vs
 * written by the author, a cell nobody has filled vs one the language says
 * cannot exist — were carried entirely by an italic and two punctuation marks,
 * explained only in `title` tooltips. A tooltip is invisible on a phone, absent
 * to most assistive technology, and undiscoverable to the reader most likely to
 * need it: the whole point of the empty/excluded distinction is lost on anyone
 * who does not already know the notation.
 *
 * **It names only what is on screen.** A paradigm with no derived form should
 * not explain italics, and one with no exclusions should not teach an em dash
 * the reader will never meet — a legend for absent things is how a legend
 * becomes noise people learn to skip.
 */
function ParadigmLegend({
  blocks,
  held,
}: {
  blocks: readonly ResolvedLayoutBlock[];
  held: (address: LayoutAddress) => readonly DisplayForm[] | undefined;
}): ReactNode {
  const { t } = useTranslation();

  let derived = false;
  let asserted = false;
  let empty = false;
  let excluded = false;
  for (const block of blocks) {
    for (const cell of blockCells(block)) {
      for (const form of held(cell) ?? []) {
        if (form.generated) derived = true;
        else asserted = true;
      }
    }
    // Only a table draws the two absent states — a list simply omits them — and
    // in a table an *excluded* address is `undefined` in the grid while an
    // unfilled one is an address nothing is placed at. Read off `cells` rather
    // than `blockCells`, which drops the exclusions before we could count them.
    if (block.kind !== "table") continue;
    for (const line of block.cells) {
      for (const address of line) {
        if (address === undefined) excluded = true;
        else if (held(address) === undefined) empty = true;
      }
    }
  }

  // One convention on its own explains nothing — "italic means derived" is only
  // information when something non-italic is beside it.
  const rows: { mark: ReactNode; text: string }[] = [];
  if (derived && asserted) {
    rows.push({ mark: <span className="italic">abc</span>, text: t("entry.legendDerived") });
    rows.push({ mark: <span>abc</span>, text: t("entry.legendAsserted") });
  }
  if (empty) rows.push({ mark: <span>·</span>, text: t("entry.legendEmpty") });
  if (excluded) rows.push({ mark: <span>—</span>, text: t("entry.legendExcluded") });
  if (rows.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-subtle">
      {rows.map((row, i) => (
        <li key={i} className="flex items-baseline gap-1.5">
          <span aria-hidden="true" className="text-content-muted">
            {row.mark}
          </span>
          <span>{row.text}</span>
        </li>
      ))}
    </ul>
  );
}
