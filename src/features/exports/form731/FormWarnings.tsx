// Screen-only list of what is missing from a filled form (never printed).
export function FormWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <div className="pgf-form-warnings no-print" role="note" data-testid="form-warnings">
      <strong>Fill in by hand or complete the details first:</strong>
      <ul>
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}
