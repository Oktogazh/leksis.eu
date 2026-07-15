import { compareDefinitionPlaces, type EntryDefinition } from "@leksis/types";

// Utilities for the definitions hierarchy (a flat list of definitions, each
// carrying its coordinate `place` — see the entry lexicon): display
// numbering, and the editor's tree model with its arrow-movement operations.
// The editor works on a tree (groups make the movement rules natural) and
// serializes to/from the record's flat, place-carrying shape.
//
// Numbering follows the entry's deepest place length:
//   depth 1 → 1. 2. 3.          (arabic)
//   depth 2 → I. 1.  /  II. 1.  (roman, then arabic)
//   depth 3 → A. I. 1.          (letters, roman, then arabic)

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
 * Label for the item at `index` (0-based) of a dimension, given the entry's
 * total depth and the dimension's level (1-based).
 */
export function numberingLabel(totalDepth: DefinitionDepth, level: number, index: number): string {
  const scheme =
    totalDepth === 1 ? ["arabic"] : totalDepth === 2 ? ["roman", "arabic"] : ["alpha", "roman", "arabic"];
  const kind = scheme[level - 1] ?? "arabic";
  const n = index + 1;
  return `${kind === "roman" ? toRoman(n) : kind === "alpha" ? toAlpha(n) : String(n)}.`;
}

/** Deepest dimension used by a record's definitions (1–3): longest place. */
export function definitionsDepth(definitions: EntryDefinition[]): DefinitionDepth {
  let depth = 1;
  for (const def of definitions) depth = Math.max(depth, Math.min(def.place.length, 3));
  return depth as DefinitionDepth;
}

/** Full display label of a definition's place, e.g. [1, 0] → "II. 1.". */
export function placeLabel(totalDepth: DefinitionDepth, place: number[]): string {
  return place.map((index, i) => numberingLabel(totalDepth, i + 1, index)).join(" ");
}

// ---------------------------------------------------------------------------
// Editor tree model. Payload P is the editor's leaf state (text + note
// chips); this module only cares about the shape and the movement rules.

export interface EditLeaf<P> {
  kind: "leaf";
  id: number;
  payload: P;
}

export interface EditGroup<P> {
  kind: "group";
  id: number;
  children: EditNode<P>[];
}

export type EditNode<P> = EditLeaf<P> | EditGroup<P>;

/** Deepest dimension used by the editor tree (1–3). */
export function editTreeDepth<P>(nodes: EditNode<P>[]): DefinitionDepth {
  let depth = 1;
  for (const node of nodes) {
    if (node.kind === "group") {
      depth = Math.max(depth, node.children.some((c) => c.kind === "group") ? 3 : 2);
    }
  }
  return depth as DefinitionDepth;
}

/** Labels for every node id, per the numbering scheme of the tree's depth. */
export function editTreeLabels<P>(nodes: EditNode<P>[]): Map<number, string> {
  const depth = editTreeDepth(nodes);
  const labels = new Map<number, string>();
  const walk = (level: number, prefix: string, siblings: EditNode<P>[]) => {
    siblings.forEach((node, i) => {
      const label = `${prefix}${numberingLabel(depth, level, i)}`;
      labels.set(node.id, label);
      if (node.kind === "group") walk(level + 1, `${label} `, node.children);
    });
  };
  walk(1, "", nodes);
  return labels;
}

interface NodeLocation<P> {
  /** The array holding the node (the root list or a group's children). */
  siblings: EditNode<P>[];
  index: number;
  /** The group owning `siblings`, or null when it's the root list. */
  parent: EditGroup<P> | null;
}

function locate<P>(
  nodes: EditNode<P>[],
  id: number,
  parent: EditGroup<P> | null = null,
): NodeLocation<P> | null {
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
function levelOf<P>(nodes: EditNode<P>[], location: NodeLocation<P>): number {
  let level = 1;
  let parent = location.parent;
  while (parent !== null) {
    level += 1;
    const up = locate(nodes, parent.id);
    parent = up?.parent ?? null;
  }
  return level;
}

/** Structural clone: fresh arrays/groups, shared leaf payloads. */
function cloneTree<P>(nodes: EditNode<P>[]): EditNode<P>[] {
  return nodes.map((node) =>
    node.kind === "group" ? { ...node, children: cloneTree(node.children) } : node,
  );
}

/** Drop empty groups anywhere in the tree (movement can empty them). */
function pruneEmptyGroups<P>(nodes: EditNode<P>[]): EditNode<P>[] {
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
export function moveDown<P>(nodes: EditNode<P>[], id: number): EditNode<P>[] {
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
export function moveUp<P>(nodes: EditNode<P>[], id: number): EditNode<P>[] {
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
 * Wrap a leaf into a new group in place (one dimension deeper). Illegal on
 * the third dimension and on groups.
 */
export function indent<P>(nodes: EditNode<P>[], id: number, nextId: () => number): EditNode<P>[] {
  const tree = cloneTree(nodes);
  const loc = locate(tree, id);
  if (!loc) return nodes;
  const node = loc.siblings[loc.index]!;
  if (node.kind !== "leaf") return nodes;
  if (levelOf(tree, loc) >= 3) return nodes;
  loc.siblings[loc.index] = { kind: "group", id: nextId(), children: [node] };
  return tree;
}

/**
 * Move a leaf out of its group, right after it (one dimension shallower);
 * the group disappears if that empties it. Illegal at the root.
 */
export function outdent<P>(nodes: EditNode<P>[], id: number): EditNode<P>[] {
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
export function removeLeaf<P>(nodes: EditNode<P>[], id: number): EditNode<P>[] {
  const tree = cloneTree(nodes);
  const loc = locate(tree, id);
  if (!loc) return nodes;
  loc.siblings.splice(loc.index, 1);
  return pruneEmptyGroups(tree);
}

/** Replace a leaf's payload. */
export function updateLeaf<P>(nodes: EditNode<P>[], id: number, patch: (payload: P) => P): EditNode<P>[] {
  const tree = cloneTree(nodes);
  const loc = locate(tree, id);
  if (!loc) return nodes;
  const node = loc.siblings[loc.index]!;
  if (node.kind !== "leaf") return nodes;
  loc.siblings[loc.index] = { ...node, payload: patch(node.payload) };
  return tree;
}

/** All leaves in visual order (for validation and serialization checks). */
export function collectLeaves<P>(nodes: EditNode<P>[]): EditLeaf<P>[] {
  const leaves: EditLeaf<P>[] = [];
  const walk = (siblings: EditNode<P>[]) => {
    for (const node of siblings) {
      if (node.kind === "leaf") leaves.push(node);
      else walk(node.children);
    }
  };
  walk(nodes);
  return leaves;
}

/**
 * Serialize the editor tree to the record's flat definitions, dropping
 * leaves whose text is empty (and groups that empties). Places are the
 * remaining nodes' sibling positions, so they come out sorted and contiguous.
 */
export function toRecordDefinitions<P>(
  nodes: EditNode<P>[],
  leafToRecord: (payload: P) => Omit<EntryDefinition, "place"> | null,
): EntryDefinition[] {
  type Kept =
    | { kind: "leaf"; def: Omit<EntryDefinition, "place"> }
    | { kind: "group"; children: Kept[] };
  const prune = (siblings: EditNode<P>[]): Kept[] =>
    siblings.flatMap((node): Kept[] => {
      if (node.kind === "leaf") {
        const def = leafToRecord(node.payload);
        return def === null ? [] : [{ kind: "leaf", def }];
      }
      const children = prune(node.children);
      return children.length === 0 ? [] : [{ kind: "group", children }];
    });

  const out: EntryDefinition[] = [];
  const flatten = (siblings: Kept[], prefix: number[]) => {
    siblings.forEach((node, i) => {
      const place = [...prefix, i];
      if (node.kind === "leaf") out.push({ place, ...node.def });
      else flatten(node.children, place);
    });
  };
  flatten(prune(nodes), []);
  return out;
}

/**
 * Build an editor tree from a record's flat definitions: sorted into reading
 * order, then consecutive definitions sharing a place index at each level
 * fold into one group.
 */
export function fromRecordDefinitions<P>(
  definitions: EntryDefinition[],
  recordToLeaf: (definition: EntryDefinition) => P,
  nextId: () => number,
): EditNode<P>[] {
  const sorted = [...definitions].sort((a, b) => compareDefinitionPlaces(a.place, b.place));
  const build = (defs: EntryDefinition[], level: number): EditNode<P>[] => {
    const out: EditNode<P>[] = [];
    let i = 0;
    while (i < defs.length) {
      const def = defs[i]!;
      if (def.place.length <= level + 1) {
        out.push({ kind: "leaf", id: nextId(), payload: recordToLeaf(def) });
        i += 1;
        continue;
      }
      const index = def.place[level]!;
      const groupDefs: EntryDefinition[] = [];
      while (i < defs.length && defs[i]!.place.length > level + 1 && defs[i]!.place[level] === index) {
        groupDefs.push(defs[i]!);
        i += 1;
      }
      out.push({ kind: "group", id: nextId(), children: build(groupDefs, level + 1) });
    }
    return out;
  };
  return build(sorted, 0);
}
