// The admin tabs: Pilots (/admin) | Errors (/admin/errors) | E-mails (/admin/mail).
import { useNavigate } from 'react-router-dom';

export function AdminNav({ current }: { current: 'pilots' | 'errors' | 'mail' }) {
  const navigate = useNavigate();
  return (
    <nav className="tabs" aria-label="Admin">
      <button type="button" aria-pressed={current === 'pilots'} onClick={() => navigate('/admin')}>Pilots</button>
      <button type="button" aria-pressed={current === 'errors'} onClick={() => navigate('/admin/errors')}>Errors</button>
      <button type="button" aria-pressed={current === 'mail'} onClick={() => navigate('/admin/mail')}>E-mails</button>
    </nav>
  );
}
