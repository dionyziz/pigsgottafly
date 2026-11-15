// /flights/new: creates a flight with the profile defaults (server side) and opens it.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../data/api';

export function NewFlightPage() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.flights.create({}).then((f) => navigate(`/flights/${f.id}`, { replace: true }), (e) => setError(String(e.message || e)));
  }, [navigate]);
  return <div className="loading-screen">{error ? `Could not create the flight: ${error}` : 'Creating flight…'}</div>;
}
