// The "SIGN ____" line at the foot of the MD 4.3 and MD 4.4 sheets, with the PIC's e-signature
// on it (the same handwriting signature as on Form 731 and the General Declaration).
import { type ShownSignature, Signature } from '../form731/Form731';

export function SignLine({ signature }: { signature?: ShownSignature | null }) {
  return (
    <span className="sign">
      SIGN
      <span className="xp-sigline" data-field="signature">
        {signature && (
          <span className="xp-pic-signature">
            <Signature s={signature} size={4.2} />
          </span>
        )}
      </span>
    </span>
  );
}
