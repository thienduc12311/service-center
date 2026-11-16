import { useMemo } from 'react';
import { timeZoneOptions } from '../lib/timezones';
import { SelectField } from './ui';

export interface TimeZoneFieldProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  label?: string;
}

export const TimeZoneField = ({ value, onChange, error, label = 'Time zone' }: TimeZoneFieldProps) => {
  const zones = useMemo(() => timeZoneOptions(value), [value]);
  return (
    <SelectField label={label} value={value} onChange={(event) => onChange(event.target.value)} error={error}>
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone.replace(/_/g, ' ')}
        </option>
      ))}
    </SelectField>
  );
};
