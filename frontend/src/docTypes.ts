/** Shape of the translator returned by useT(). */
type TFunc = (key: string, vars?: Record<string, string | number>) => string

/**
 * The document types seeded into every project database, with the exact English
 * label the migration writes (see backend/database.py).
 *
 * The label lives in the database, so it cannot be translated at the source.
 * The UI translates by key instead — but only while the stored label is still
 * the untouched seed. Once someone renames a type in the type manager, their
 * label wins, otherwise the rename would silently have no effect.
 */
const SEED_LABELS: Record<string, string> = {
  birth_cert:    'Birth certificate',
  death_cert:    'Death certificate',
  marriage_cert: 'Marriage certificate',
  baptism:       'Baptism record',
  burial_record: 'Burial record',
  passport:      'Passport',
  military:      'Military record',
  land_record:   'Land record',
  will:          'Will / Testament',
  letter:        'Letter',
  photo:         'Photograph',
  other:         'Document',
}

export const BUILTIN_DOC_TYPE_KEYS = Object.keys(SEED_LABELS)

/**
 * Display label for a document type: translated for untouched built-ins, the
 * stored label for renamed or user-created ones, the raw key as a last resort.
 */
export function docTypeLabel(
  t: TFunc,
  key: string | null | undefined,
  storedLabel?: string | null,
): string {
  if (key && key in SEED_LABELS && (!storedLabel || storedLabel === SEED_LABELS[key])) {
    return t(`docType.${key}`)
  }
  return storedLabel || key || t('docType.other')
}

/** Built-in [key, label] pairs, for the offline fallback when the type list fails to load. */
export function builtinDocTypeOptions(t: TFunc): Array<[string, string]> {
  return BUILTIN_DOC_TYPE_KEYS.map(k => [k, t(`docType.${k}`)])
}
