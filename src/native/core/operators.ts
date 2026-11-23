// The operator pages and the documents section as the website shows them [operators/model.ts,
// hangar/documents.ts]: the editor's checks and body, its head and people, the list's rows, a new
// operator, and the documents' rows and upload rules.
import {
  AIRCRAFT_FILE_CHUNK_BYTES,
  DOCUMENT_LIMIT_HINT,
  DOCUMENT_MAX_BYTES,
  documentDetail,
  documentPickError,
  documentRename,
  documentTitle,
} from '../../features/hangar/documents';
import {
  newOperatorInput,
  normalizedOperator,
  operatorHead,
  operatorInputOf,
  operatorPeople,
  operatorRow,
  validateOperator,
} from '../../features/operators/model';
import {
  type AircraftFile,
  EMPTY_OPERATOR,
  type OperatorInput,
  type OperatorItem,
  type OperatorSharing,
} from '../../shared';
import { arg, type Json, plain } from './shared';

/**
 * The operator editor. `operator` is GET /api/operators/:id; `draft` the fields as edited (default:
 * the operator's); `people` GET /api/operators/:id/shares' people, for "People with access". Returns
 * the fields (`input`), the issues that hold the save back (`issues`, by field), the body of PUT
 * /api/operators/:id (`body`, null while there are issues), the head and the people.
 */
export function operatorForm(
  input: Json<{
    operator: OperatorItem;
    draft?: OperatorInput | null;
    people?: OperatorSharing['people'] | null;
    myId?: string;
  }>,
) {
  const i = arg(input);
  // a field missing from the answer (an older record) starts empty, as on a new operator
  const fields = operatorInputOf({ ...EMPTY_OPERATOR, ...(i.draft ?? i.operator) });
  const issues = validateOperator(fields);
  return plain({
    input: fields,
    issues,
    body: issues.length ? null : normalizedOperator(fields),
    head: operatorHead(i.operator),
    people: i.people ? operatorPeople(i.people, i.myId ?? '') : null,
  });
}

/** The operators list's rows (GET /api/operators). */
export function operatorList(input: Json<{ operators: OperatorItem[] }>) {
  return plain({ rows: (arg(input).operators ?? []).map(operatorRow) });
}

/** New operator: `{ error }` or the `body` of POST /api/operators for the typed name. */
export function newOperator(input: Json<{ name?: string }>) {
  const made = newOperatorInput(String(arg(input).name ?? ''));
  return plain({ body: made.input, error: made.error });
}

/**
 * An aircraft's or operator's documents. `documents`: GET …/files' documents (the rows: title and
 * the detail line); `pick` a chosen file `{ type, size, name }` and `title` the title typed (then
 * `pickError`, or `start`: the body of POST …/files); `rename` `{ title, typed }` (then `renamed`: the
 * title to save, or null).
 */
export function documents(
  input: Json<{
    documents?: AircraftFile[];
    pick?: { type: string; size: number; name: string } | null;
    title?: string;
    rename?: { title: string; typed: string } | null;
  }>,
) {
  const i = arg(input);
  const pickError = i.pick ? documentPickError(i.pick) : null;
  return plain({
    rows: (i.documents ?? []).map((f) => ({ id: f.id, title: f.title, detail: documentDetail(f) })),
    hint: DOCUMENT_LIMIT_HINT,
    maxBytes: DOCUMENT_MAX_BYTES,
    chunkBytes: AIRCRAFT_FILE_CHUNK_BYTES,
    pickError,
    start:
      i.pick && !pickError
        ? {
            kind: 'document',
            name: i.pick.name,
            title: documentTitle(i.title ?? '', i.pick.name),
            mime: i.pick.type,
            size: i.pick.size,
          }
        : null,
    renamed: i.rename ? documentRename(i.rename, i.rename.typed) : null,
  });
}
