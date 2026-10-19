import { useState } from 'react';
import { useServiceTypes } from '../../hooks/queries';
import { FilesPanel } from '../files/FilesPanel';

/**
 * Default files of a service type: every new plan of that type links them,
 * pinned to the version current when the plan is created. Replacing a
 * default later never changes existing plans.
 */
export const ServiceTypeFilesSettings = () => {
  const serviceTypes = useServiceTypes();
  const [selected, setSelected] = useState<string>('');
  const types = serviceTypes.data ?? [];
  const serviceTypeId = selected || types[0]?.id || '';

  if (!types.length) return null;
  return (
    <div className="space-y-3">
      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Service type default files</h2>
        <p className="mb-3 text-sm text-slate-500">
          New plans of the service type get these files automatically, pinned to the version current at that moment. Changing a
          default later does not change plans that already exist.
        </p>
        <label className="block max-w-sm">
          <span className="label">Service type</span>
          <select className="input" value={serviceTypeId} onChange={(event) => setSelected(event.target.value)}>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      {serviceTypeId && <FilesPanel key={serviceTypeId} owner={{ kind: 'service_type', id: serviceTypeId }} title="Default files" />}
    </div>
  );
};
