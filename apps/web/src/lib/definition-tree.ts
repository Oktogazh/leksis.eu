import {
  compareDefinitionPlaces,
  isLeafPlace,
  validateDefinitions,
  type DefinitionsError,
  type EntryDefinition,
} from "@leksis/types";

// Utilities for the definition tree (a flat list of nodes, each carrying its
// address `place` — see the entry lexicon): display numbering, and the
// editor's tree model with its arrow-movement operations. The editor works on
// a tree (leaves carry text, group nodes carry notes) and serializes to/from
// the record's flat, place-carrying shape.
//
// Place convention (see EntryDefinition): the place is fixed to the tree's
// depth D. A leaf fills its dimensions from the right, so its arabic number is
// the LAST index (non-zero); a group node fills its own dimensions but leaves
// the last index 0. A 0 at any position is skipped in display, and a non-zero
// value n shows as the n-th label of its dimension:
//   depth 1 → 1. 2. 3.          (arabic)
//   depth 2 → I. 1.  /  II.     (roman, then arabic)
//   depth 3 → A. I. 1.  /  A. II. (letters, roman, then arabic)

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

function toRoman(n: number): string {
  let out = "";
  let rest = n;
  for (const [value, glyph] of ROMAN) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

function toAlpha(n: number): string {
  let out = "";
  let rest = n;
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(65 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

export type DefinitionDepth = 1 | 2 | 3;

/**
 * Numbering scheme by dimension for a tree of the given depth. Position i
 * (0-based) is dimension i; the last is always arabic (the leaf's number).
 */
function schemeFor(totalDepth: DefinitionDepth): ("alpha" | "roman" | "arabic")[] {
  return totalDepth === 1
    ? ["arabic"]
    : totalDepth === 2
      ? ["roman", "arabic"]
      : ["alpha", "roman", "arabic"];
}

/**
 * Label for a non-zero index `value` (1-based: 1 → A/I/1, 2 → B/II/2) at
 * dimension `position` (0-based) of a tree of the given depth.
 */
export function numberingLabel(totalDepth: DefinitionDepth, position: number, value: number): string {
  const kind = schemeFor(totalDepth)[position] ?? "arabic";
  return `${kind === "roman" ? toRoman(value) : kind === "alpha" ? toAlpha(value) : String(value)}.`;
}

/** Deepest dimension used by a record's definitions (1–3): longest place. */
export function definitionsDepth(definitions: EntryDefinition[]): DefinitionDepth {
  let depth = 1;
  for (const def of definitions) depth = Math.max(depth, Math.min(def.place.length, 3));
  return depth as DefinitionDepth;
}

/**
 * Full display label of a place under its tree depth, skipping 0 indices —
 * e.g. depth 3: [1, 2, 0] → "A. II.", [0, 1, 1] → "I. 1.", [0, 0, 1] → "1.".
 */
export function placeLabel(totalDepth: DefinitionDepth, place: number[]): string {
  return place
    .map((value, i) => (value === 0 ? null : numberingLabel(totalDepth, i, value)))
    .filter((label): label is string => label !== null)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Editor tree model. Payload P is the editor's leaf state (text + note
// chips); this module only cares about the shape and the movement rules.

export interface EditLeaf<P> {
  kind: "leaf";
  id: number;
  payload: P;
}

/**
 * A group node. Beyond holding children, it carries its own group-level
 * payload G (its notes/plain notes), so an annotated heading (e.g. the
 * "transitive" grouping) survives the tree round-trip.
 */
export interface EditGroup<P, G> {
  kind: "group";
  id: number;
  group: G;
  children: EditNode<P, G>[];
}

export type EditNode<P, G> = EditLeaf<P> | EditGroup<P, G>;

/** Deepest dimension used by the editor tree (1–3). */
export function editTreeDepth<P, G>(nodes: EditNode<P, G>[]): DefinitionDepth {
  let depth = 1;
  for (const node of nodes) {
    if (node.kind === "group") {
      depth = Math.max(depth, node.children.some((c) => c.kind === "group") ? 3 : 2);
    }
  }
  return depth as DefinitionDepth;
}

/**
 * Labels for every node id, per the numbering scheme of the tree's depth.
 * Mirrors `toRecordDefinitions`: each sibling advances one dimension, a group
 * occupies its slot, and a leaf shallower than the remaining depth is promoted
 * to a numbered slot with a lone arabic child (so it shows e.g. "II. 1."
 * beside a group's "I. 1.").
 */
export function editTreeLabels<P, G>(nodes: EditNode<P, G>[]): Map<number, string> {
  const depth = editTreeDepth(nodes);
  const labels = new Map<number, string>();
  const walk = (prefix: string, position: number, dimensionsLeft: number, siblings: EditNode<P, G>[]) => {
    siblings.forEach((node, i) => {
      const own = numberingLabel(depth, position, i + 1);
      if (node.kind === "leaf") {
        // A promoted leaf (shallower than the remaining depth) gets its slot
        // number plus a lone "1" label at every deeper dimension, matching the
        // singleton-group chain the serializer emits.
        const deeper = Array.from({ length: dimensionsLeft - 1 }, (_, k) =>
          numberingLabel(depth, position + 1 + k, 1),
        );
        labels.set(node.id, [`${prefix}${own}`, ...deeper].join(" "));
      } else {
        labels.set(node.id, `${prefix}${own}`);
        walk(`${prefix}${own} `, position + 1, dimensionsLeft - 1, node.children);
      }
    });
  };
  walk("", 0, depth, nodes);
  return labels;
}

interface NodeLocation<P, G> {
  /** The array holding the node (the root list or a group's children). */
  siblings: EditNode<P, G>[];
  index: number;
  /** The group owning `siblings`, or null when it's the root list. */
  parent: EditGroup<P, G> | null;
}

function locate<P, G>(
  nodes: EditNode<P, G>[],
  id: number,
  parent: EditGroup<P, G> | null = null,
): NodeLocation<P, G> | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.id === id) return { siblings: nodes, index: i, parent };
    if (node.kind === "group") {
      const found = locate(node.children, id, node);
      if (found) return found;
    }
  }
  return null;
}

/** 1-based dimension a node's siblings live at (root = 1). */
function levelOf<P, G>(nodes: EditNode<P, G>[], location: NodeLocation<P, G>): number {
  let level = 1;
  let parent = location.parent;
  while (parent !== null) {
    level += 1;
    const up = locate(nodes, parent.id);
    parent = up?.parent ?? null;
  }
  return level;
}

/** Structural clone: fresh arrays/groups, shared leaf and group payloads. */
function cloneTree<P, G>(nodes: EditNode<P, G>[]): EditNode<P, G>[] {
  return nodes.map((node) =>
    node.kind === "group" ? { ...node, children: cloneTree(node.children) } : node,
  );
}

/** Drop empty groups anywhere in the tree (movement can empty them). */
function pruneEmptyGroups<P, G>(nodes: EditNode<P, G>[]): EditNode<P, G>[] {
  return nodes
    .map((node) =>
      node.kind === "group" ? { ...node, children: pruneEmptyGroups(node.children) } : node,
    )
    .filter((node) => node.kind === "leaf" || node.children.length > 0);
}

/**
 * Move a node one visual step down: swap with the next sibling; entering a
 * group when the next sibling is one (a leaf lands at its head); leaving the
 * parent group when already at its tail. Groups themselves only swap.
 * Returns a new tree, or the input tree unchanged when the move is illegal.
 */
export function moveDown<P, G>(nodes: EditNode<P, G>[], id: number): EditNode<P, G>[] {
  const tree = cloneTree(nodes);
  const loc = locate(tree, id);
  if (!loc) return nodes;
  const node = loc.siblings[loc.index]!;

  const next = loc.siblings[loc.index + 1];
  if (next !== undefined) {
    if (node.kind === "leaf" && next.kind === "group") {
      loc.siblings.splice(loc.index, 1);
      next.children.unshift(node);
    } else {
      loc.siblings[loc.index] = next;
      loc.siblings[loc.index + 1] = node;
    }
    return pruneEmptyGroups(tree);
  }
  if (loc.parent !== null && node.kind === "leaf") {
    const parentLoc = locate(tree, loc.parent.id)!;
    loc.siblings.splice(loc.index, 1);
    parentLoc.siblings.splice(parentLoc.index + 1, 0, node);
    return pruneEmptyGroups(tree);
  }
  return nodes;
}

/** Mirror of moveDown: up across siblings, entering a preceding group at its tail. */
export function moveUp<P, G>(nodes: EditNode<P, G>[], id: number): EditNode<P, G>[] {
  const tree = cloneTree(nodes);
  const loc = locate(tree, id);
  if (!loc) return nodes;
  const node = loc.siblings[loc.index]!;

  const prev = loc.siblings[loc.index - 1];
  if (prev !== undefined) {
    if (node.kind === "leaf" && prev.kind === "group") {
      loc.siblings.splice(loc.index, 1);
      prev.children.push(node);
    } else {
      loc.siblings[loc.index] = prev;
      loc.siblings[loc.index - 1] = node;
    }
    return pruneEmptyGroups(tree);
  }
  if (loc.parent !== null && node.kind === "leaf") {
    const parentLoc = locate(tree, loc.parent.id)!;
    loc.siblings.splice(loc.index, 1);
    parentLoc.siblings.splice(parentLoc.index, 0, node);
    return pruneEmptyGroups(tree);
  }
  return nodes;
}

/**
 * Wrap a leaf into a new group in place (one dimension deeper), carrying a
 * fresh (empty) group payload. Illegal on the third dimension and on groups.
 */
export function indent<P, G>(
  nodes: EditNode<P, G>[],
  id: number,
  nextId: () => number,
  emptyGroup: () => G,
): EditNode<P, G>[] {
  const tree = cloneTree(nodes);
  const loc = locate(tree, id);
  if (!loc) return nodes;
  const node = loc.siblings[loc.index]!;
  if (node.kind !== "leaf") return nodes;
  if (levelOf(tree, loc) >= 3) return nodes;
  loc.siblings[loc.index] = { kind: "group", id: nextId(), group: emptyGroup(), children: [node] };
  return tree;
}

/**
 * Move a leaf out of its group, right after it (one dimension shallower);
 * the group disappears if that empties it. Illegal at the root.
 */
export function outdent<P, G>(nodes: EditNode<P, G>[], id: number): EditNode<P, G>[] {
  const tree = cloneTree(nodes);
  const loc = locate(tree, id);
  if (!loc || loc.parent === null) return nodes;
  const node = loc.siblings[loc.index]!;
  if (node.kind !== "leaf") return nodes;
  const parentLoc = locate(tree, loc.parent.id)!;
  loc.siblings.splice(loc.index, 1);
  parentLoc.siblings.splice(parentLoc.index + 1, 0, node);
  return pruneEmptyGroups(tree);
}

/** Remove a leaf (and any group this empties). */
export function removeLeaf<P, G>(nodes: EditNode<P, G>[], id: number): EditNode<P, G>[] {
  const tree = cloneTree(nodes);
  const loc = locate(tree, id);
  if (!loc) return nodes;
  loc.siblings.splice(loc.index, 1);
  return pruneEmptyGroups(tree);
}

/** Replace a leaf's payload. */
export function updateLeaf<P, G>(
  nodes: EditNode<P, G>[],
  id: number,
  patch: (payload: P) => P,
): EditNode<P, G>[] {
  const tree = cloneTree(nodes);
  const loc = locate(tree, id);
  if (!loc) return nodes;
  const node = loc.siblings[loc.index]!;
  if (node.kind !== "leaf") return nodes;
  loc.siblings[loc.index] = { ...node, payload: patch(node.payload) };
  return tree;
}

/** Replace a group node's own payload (its notes). */
export function updateGroup<P, G>(
  nodes: EditNode<P, G>[],
  id: number,
  patch: (group: G) => G,
): EditNode<P, G>[] {
  const tree = cloneTree(nodes);
  const loc = locate(tree, id);
  if (!loc) return nodes;
  const node = loc.siblings[loc.index]!;
  if (node.kind !== "group") return nodes;
  loc.siblings[loc.index] = { ...node, group: patch(node.group) };
  return tree;
}

/** All leaves in visual order (for validation and serialization checks). */
export function collectLeaves<P, G>(nodes: EditNode<P, G>[]): EditLeaf<P>[] {
  const leaves: EditLeaf<P>[] = [];
  const walk = (siblings: EditNode<P, G>[]) => {
    for (const node of siblings) {
      if (node.kind === "leaf") leaves.push(node);
      else walk(node.children);
    }
  };
  walk(nodes);
  return leaves;
}

/**
 * Serialize the editor tree to the record's flat definitions. Empty leaves
 * (no text) are dropped along with any group they empty; a group node is
 * emitted as its own item only when it carries content (`groupToRecord`
 * returns a non-null notes/plainNotes payload), so bare grouping stays
 * implicit. Places follow the tree convention (see EntryDefinition): a leaf's
 * number is its last index, a group's last index is 0, and the array comes out
 * sorted in reading order.
 *
 * Mixed siblings (a bare definition beside a group at the same level) are
 * resolved by promoting the bare leaf into its own numbered slot with an
 * arabic child — so "I. 1. / I. 2." and a plain sense beside them become
 * "I. 1. / I. 2. / II. 1." rather than an un-orderable mix.
 */
export function toRecordDefinitions<P, G>(
  nodes: EditNode<P, G>[],
  leafToRecord: (payload: P) => Omit<EntryDefinition, "place"> | null,
  groupToRecord: (group: G) => Omit<EntryDefinition, "place" | "text"> | null,
): EntryDefinition[] {
  type Kept =
    | { kind: "leaf"; def: Omit<EntryDefinition, "place"> }
    | { kind: "group"; def: Omit<EntryDefinition, "place" | "text"> | null; children: Kept[] };
  // Prune empty leaves and the groups they leave empty; keep a surviving
  // group's own (possibly null) record payload.
  const prune = (siblings: EditNode<P, G>[]): Kept[] =>
    siblings.flatMap((node): Kept[] => {
      if (node.kind === "leaf") {
        const def = leafToRecord(node.payload);
        return def === null ? [] : [{ kind: "leaf", def }];
      }
      const children = prune(node.children);
      return children.length === 0
        ? []
        : [{ kind: "group", def: groupToRecord(node.group), children }];
    });

  const keptDepth = (siblings: Kept[]): number => {
    let d = 1;
    for (const node of siblings) {
      if (node.kind === "group") d = Math.max(d, 1 + keptDepth(node.children));
    }
    return d;
  };

  const pruned = prune(nodes);
  const depth = keptDepth(pruned);
  const out: EntryDefinition[] = [];

  // `dimensionsLeft` is how many place slots remain from this level down to
  // the arabic dimension (starts at `depth`). A leaf fills the remaining slots
  // with its own number then 0-pads none; a group fills one slot then recurses
  // with one fewer. When siblings mix depths, every sibling still advances one
  // slot, and a leaf that is shallower than the remaining depth gets its
  // number followed by an implicit arabic 1 (and inner 0s) — i.e. it is
  // promoted to a numbered slot with a lone arabic child.
  const walk = (siblings: Kept[], prefix: number[], dimensionsLeft: number) => {
    siblings.forEach((node, i) => {
      const slot = [...prefix, i + 1];
      if (node.kind === "leaf") {
        // Pad down to the arabic dimension: a leaf shallower than the
        // remaining depth is promoted to a numbered slot, then a lone "1" at
        // every deeper dimension (a singleton group chain). This keeps the
        // tree round-trippable — every promoted leaf reads back to the same
        // structure — at the cost of showing e.g. "B. I. 1." rather than
        // "B. 1." for a lone plain sense beside a three-deep group.
        const place = [...slot, ...Array<number>(dimensionsLeft - 1).fill(1)];
        out.push({ place, ...node.def });
      } else {
        // A group occupies this slot; its arabic (and any deeper) dimensions
        // are 0 for the group node itself. It carries content only when kept.
        if (node.def !== null) {
          out.push({
            place: [...slot, ...Array<number>(dimensionsLeft - 1).fill(0)],
            ...node.def,
          });
        }
        walk(node.children, slot, dimensionsLeft - 1);
      }
    });
  };
  walk(pruned, [], depth);
  out.sort((a, b) => compareDefinitionPlaces(a.place, b.place));
  return out;
}

/**
 * Build an editor tree from a record's flat definitions. The list is read
 * under the tree convention: each definition's displayed path (its non-zero
 * indices) locates it, group nodes (last index 0) becoming interior nodes
 * that carry their notes, leaves carrying text. Missing (implicit) groups are
 * synthesised so the tree is complete. Robust to loosely-valid records: it
 * never throws, filling gaps with empty leaves rather than failing.
 */
export function fromRecordDefinitions<P, G>(
  definitions: EntryDefinition[],
  recordToLeaf: (definition: EntryDefinition) => P,
  recordToGroup: (definition: EntryDefinition) => G,
  emptyGroup: () => G,
  nextId: () => number,
): EditNode<P, G>[] {
  // The displayed path of a place: its non-zero indices, dropping a trailing
  // 0 (the group-type marker). e.g. [1,2,0] → [1,2]; [0,1,1] → [1,1];
  // [0,0,1] → [1]. The path values are the 1-based sibling positions.
  const pathOf = (place: number[]): number[] =>
    place.filter((n, i) => n !== 0 || i === place.length - 1).filter((n) => n !== 0);

  const roots: EditNode<P, G>[] = [];
  // Index groups by their path (joined) so a leaf can attach under the right
  // ancestors, creating implicit groups on the way down.
  const groupByPath = new Map<string, EditGroup<P, G>>();

  const ensureGroup = (path: number[]): EditNode<P, G>[] => {
    // Returns the children array a node at `path` should live in.
    if (path.length === 0) return roots;
    const key = path.join(",");
    let group = groupByPath.get(key);
    if (!group) {
      group = { kind: "group", id: nextId(), group: emptyGroup(), children: [] };
      groupByPath.set(key, group);
      ensureGroup(path.slice(0, -1)).push(group);
    }
    return group.children;
  };

  const sorted = [...definitions].sort((a, b) => compareDefinitionPlaces(a.place, b.place));
  for (const def of sorted) {
    const path = pathOf(def.place);
    if (isLeafPlace(def.place)) {
      // The last path value is the leaf's own position; its parent is the
      // prefix. (The position itself is implied by array order, so it's not
      // used as a key — siblings just append in reading order.)
      ensureGroup(path.slice(0, -1)).push({
        kind: "leaf",
        id: nextId(),
        payload: recordToLeaf(def),
      });
    } else {
      // A group node: materialise it (or fill in its payload if a descendant
      // leaf already created it implicitly).
      const key = path.join(",");
      const existing = groupByPath.get(key);
      if (existing) {
        existing.group = recordToGroup(def);
      } else {
        const group: EditGroup<P, G> = {
          kind: "group",
          id: nextId(),
          group: recordToGroup(def),
          children: [],
        };
        groupByPath.set(key, group);
        ensureGroup(path.slice(0, -1)).push(group);
      }
    }
  }
  return roots;
}

/**
 * Strictly validate the definitions a `toRecordDefinitions` call produced,
 * mirroring the API's `validateDefinitions` — the editor's last guard before
 * writing to the PDS. Returns "ok" or the failing rule.
 */
export function checkRecordDefinitions(definitions: EntryDefinition[]): DefinitionsError | "ok" {
  return validateDefinitions(definitions);
}
