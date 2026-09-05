export const theme = {
  colors: {
    brand: '#4f46e5',
    brandSoft: '#eef2ff',
    background: '#f8fafc',
    surface: '#ffffff',
    border: '#e2e8f0',
    text: '#0f172a',
    textMuted: '#64748b',
    textFaint: '#94a3b8',
    success: '#059669',
    successSoft: '#ecfdf5',
    warning: '#d97706',
    warningSoft: '#fffbeb',
    danger: '#e11d48',
    dangerSoft: '#fff1f2',
  },
  spacing: (units: number) => units * 4,
  radius: { sm: 8, md: 12, lg: 16, full: 999 },
} as const;

export const statusColors = {
  confirmed: { bg: theme.colors.successSoft, fg: theme.colors.success },
  declined: { bg: theme.colors.dangerSoft, fg: theme.colors.danger },
  unconfirmed: { bg: theme.colors.warningSoft, fg: theme.colors.warning },
} as const;
