import { createTheme } from '@mui/material/styles';
import { tokens } from './tokens';

export const appTheme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'light',
    primary: { main: tokens.color.brand, dark: tokens.color.brandHover, light: tokens.color.brandSoft },
    error: { main: tokens.color.danger },
    warning: { main: tokens.color.warning },
    success: { main: tokens.color.success },
    background: { default: tokens.color.surfaceMuted, paper: tokens.color.surface },
    text: { primary: tokens.color.textPrimary, secondary: tokens.color.textSecondary },
    divider: tokens.color.border,
  },
  shape: { borderRadius: tokens.radius.md },
  spacing: tokens.spacing.sm,
  typography: {
    fontFamily: 'Inter Variable, Arial, sans-serif',
    h1: { fontSize: '1.75rem', lineHeight: 1.25, fontWeight: tokens.fontWeight.display, letterSpacing: '-0.03em' },
    h2: { fontSize: '1.25rem', lineHeight: 1.35, fontWeight: tokens.fontWeight.bold, letterSpacing: '-0.02em' },
    subtitle1: { fontSize: '0.95rem', fontWeight: tokens.fontWeight.semibold },
    body1: { fontSize: '0.9rem', lineHeight: 1.55 },
    body2: { fontSize: '0.825rem', lineHeight: 1.5 },
    button: { fontSize: '0.85rem', fontWeight: tokens.fontWeight.semibold, textTransform: 'none' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        '*': { boxSizing: 'border-box' },
        'html, body, #root': { minHeight: tokens.size.full, margin: 0 },
        body: { minHeight: tokens.size.viewport },
        'button, input, textarea': { font: 'inherit' },
        '::selection': { background: tokens.color.brandSoft },
        '::-webkit-scrollbar': { width: tokens.size.scrollbar, height: tokens.size.scrollbar },
        '::-webkit-scrollbar-thumb': { background: tokens.color.border, border: tokens.effect.scrollbarBorder, borderRadius: tokens.radius.pill, backgroundClip: 'padding-box' },
        '::-webkit-scrollbar-track': { background: 'transparent' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: tokens.size.controlHeight, borderRadius: tokens.radius.md } },
    },
    MuiIconButton: { styleOverrides: { root: { minWidth: tokens.size.controlHeight, minHeight: tokens.size.controlHeight } } },
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiChip: { styleOverrides: { root: { borderRadius: tokens.radius.sm, fontWeight: tokens.fontWeight.navigation } } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: tokens.radius.lg } } },
    MuiDrawer: { styleOverrides: { paper: { border: 0, boxShadow: tokens.elevation.floating } } },
  },
});
