// Moved: <Icon name="close" /> in src/ui/Icon (and CloseButton). Kept for the old imports.
import { Icon } from '../ui/Icon';

/** The close/remove cross, drawn so it centres exactly in any square button. */
export function XIcon({ size = 10 }: { size?: number }) {
  return <Icon name="close" size={size} style={{ display: 'block' }} />;
}
