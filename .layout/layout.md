# Kontakt Board — Design System

Material Design, implemented with Material UI v7 on top of the theme and tokens in
`src/shared/design-system/`. `tokens.ts` and `theme.ts` are the single source of
truth; `.layout/tokens.css` is their machine-readable mirror for the compliance gate.

## Quick Reference

- Framework: React 19 + TypeScript strict, Material UI v7 with Emotion, `cssVariables: true`.
- Theme entry point: `src/shared/design-system/theme.ts` (`appTheme`).
- Token entry point: `src/shared/design-system/tokens.ts` (`tokens`, `stageColors`).
- Palette mode: light only. Brand `var(--color-brand)` on app background `var(--bg-app)`,
  cards on `var(--bg-surface)`, hairlines `var(--color-border)`.
- Type: Inter Variable, body copy `var(--font-size-body1)`, dense copy `var(--font-size-body2)`.
- Spacing unit: 8px. `theme.spacing(n)` = n x 8px. Named steps run
  `var(--spacing-xs)` to `var(--spacing-xxl)`.
- Radius: controls `var(--radius-md)`, chips and inner surfaces `var(--radius-sm)`,
  dialogs `var(--radius-lg)`, pills `var(--radius-pill)`, dots `var(--radius-round)`.
- Depth: `var(--elevation-card)` at rest, `var(--elevation-card-hover)` on hover,
  `var(--elevation-floating)` for drawers and menus. MUI `elevation` is 0 by default.
- Motion: `var(--motion-fast)` for hover, `var(--motion-normal)` for layout changes.
- Focus: `var(--focus-outline)` outline at `var(--focus-offset)` offset, always visible.
- Rule of thumb: reach for the Material UI component first, configure it through its own
  props and slots, and take every literal value from `tokens`.

## Design Direction

Dense, calm, operational. A sales board that is read all day, so contrast carries structure
rather than colour: white cards `var(--bg-surface)` on a muted app canvas `var(--bg-app)`,
one blue accent `var(--color-brand)`, hairline separators `var(--color-border)` instead of
heavy shadows. Semantic colour is reserved for state: `var(--color-danger)`,
`var(--color-warning)`, `var(--color-success)`, each with a soft background
(`var(--color-danger-soft)`, `var(--color-warning-soft)`, `var(--color-success-soft)`)
for inline banners. Elevated glass `var(--color-surface-glass)` with
`var(--effect-glass-blur)` is used only for the sticky top bar.

Every state is designed: loading, empty, error and success. Meaning is never carried by
colour alone — a coloured dot always sits beside its label. Keyboard operation and a visible
focus ring are mandatory.

## Colour System

| Token | Value | Source |
|-------|-------|--------|
| `var(--color-brand)` | `#315ea8` | `tokens.color.brand` |
| `var(--color-brand-hover)` | `#244d90` | `tokens.color.brandHover` |
| `var(--color-brand-soft)` | `#e9f0ff` | `tokens.color.brandSoft` |
| `var(--bg-surface)` | `#ffffff` | `tokens.color.surface` |
| `var(--bg-app)` | `#f5f7fb` | `tokens.color.surfaceMuted` |
| `var(--bg-subtle)` | `#eef1f6` | `tokens.color.surfaceSubtle` |
| `var(--text-primary)` | `#172033` | `tokens.color.textPrimary` |
| `var(--text-secondary)` | `#667085` | `tokens.color.textSecondary` |
| `var(--color-border)` | `#e3e7ee` | `tokens.color.border` |
| `var(--color-danger)` | `#c93646` | `tokens.color.danger` |
| `var(--color-danger-soft)` | `#ffeaed` | `tokens.color.dangerSoft` |
| `var(--color-warning)` | `#a95f00` | `tokens.color.warning` |
| `var(--color-warning-soft)` | `#fff2dc` | `tokens.color.warningSoft` |
| `var(--color-success)` | `#1f7a4d` | `tokens.color.success` |
| `var(--color-success-soft)` | `#e4f5ec` | `tokens.color.successSoft` |
| `var(--color-surface-glass)` | `rgba(247, 248, 252, 0.88)` | `tokens.color.surfaceGlass` |

Stage accents are data-driven: a board column picks its accent by index, so these are the
only colours allowed to come from an array rather than the palette.

| Token | Value | Source |
|-------|-------|--------|
| `var(--stage-1)` | `#5275b8` | `stageColors[0]` |
| `var(--stage-2)` | `#9a6cb3` | `stageColors[1]` |
| `var(--stage-3)` | `#c58328` | `stageColors[2]` |
| `var(--stage-4)` | `#3c8599` | `stageColors[3]` |
| `var(--stage-5)` | `#39805c` | `stageColors[4]` |
| `var(--stage-6)` | `#9b5962` | `stageColors[5]` |

In components, colours are referenced through the MUI palette (`error.main`,
`text.secondary`, `action.disabled`, `divider`), never as literals.

## Typography System

| Token | Value | Source |
|-------|-------|--------|
| `var(--font-family)` | `Inter Variable, Arial, sans-serif` | `theme.typography.fontFamily` |
| `var(--font-size-h1)` | `1.75rem` | `theme.typography.h1` |
| `var(--line-height-h1)` | `1.25` | `theme.typography.h1` |
| `var(--letter-spacing-h1)` | `-0.03em` | `theme.typography.h1` |
| `var(--font-size-h2)` | `1.25rem` | `theme.typography.h2` |
| `var(--line-height-h2)` | `1.35` | `theme.typography.h2` |
| `var(--letter-spacing-h2)` | `-0.02em` | `theme.typography.h2` |
| `var(--font-size-subtitle1)` | `0.95rem` | `theme.typography.subtitle1` |
| `var(--font-size-body1)` | `0.9rem` | `theme.typography.body1` |
| `var(--line-height-body1)` | `1.55` | `theme.typography.body1` |
| `var(--font-size-body2)` | `0.825rem` | `theme.typography.body2` |
| `var(--line-height-body2)` | `1.5` | `theme.typography.body2` |
| `var(--font-size-button)` | `0.85rem` | `theme.typography.button` |

| Token | Value | Source |
|-------|-------|--------|
| `var(--font-weight-regular)` | `450` | `tokens.fontWeight.regular` |
| `var(--font-weight-navigation)` | `620` | `tokens.fontWeight.navigation` |
| `var(--font-weight-semibold)` | `650` | `tokens.fontWeight.semibold` |
| `var(--font-weight-strong)` | `680` | `tokens.fontWeight.strong` |
| `var(--font-weight-bold)` | `700` | `tokens.fontWeight.bold` |
| `var(--font-weight-display)` | `720` | `tokens.fontWeight.display` |
| `var(--font-weight-logo)` | `800` | `tokens.fontWeight.logo` |

`textTransform` is `none` on buttons: labels stay sentence case.

## Spacing

The MUI spacing unit is 8px (`theme.spacing` = `tokens.spacing.sm`), so `spacing={2}`
and `p={2}` resolve to 16px.

| Token | Value | Source |
|-------|-------|--------|
| `var(--spacing-xs)` | `4px` | `tokens.spacing.xs` |
| `var(--spacing-sm)` | `8px` | `tokens.spacing.sm` |
| `var(--spacing-md)` | `12px` | `tokens.spacing.md` |
| `var(--spacing-lg)` | `16px` | `tokens.spacing.lg` |
| `var(--spacing-xl)` | `24px` | `tokens.spacing.xl` |
| `var(--spacing-xxl)` | `32px` | `tokens.spacing.xxl` |

| Token | Value | Source |
|-------|-------|--------|
| `var(--radius-sm)` | `8px` | `tokens.radius.sm` |
| `var(--radius-md)` | `12px` | `tokens.radius.md` |
| `var(--radius-lg)` | `18px` | `tokens.radius.lg` |
| `var(--radius-pill)` | `999px` | `tokens.radius.pill` |
| `var(--radius-round)` | `50%` | `tokens.radiusCss.round` |

| Token | Value | Source |
|-------|-------|--------|
| `var(--icon-size-small)` | `1rem` | `tokens.iconSize.small` |
| `var(--icon-size-compact)` | `0.9375rem` | `tokens.iconSize.compact` |

Fixed dimensions come from `tokens.size`; if a value is missing, add a key there rather
than writing a number into `sx`.

| Token | Value | Source |
|-------|-------|--------|
| `var(--size-nav-width)` | `224px` | `tokens.size.navWidth` |
| `var(--size-nav-compact-width)` | `72px` | `tokens.size.navCompactWidth` |
| `var(--size-topbar-height)` | `72px` | `tokens.size.topbarHeight` |
| `var(--size-control-height)` | `40px` | `tokens.size.controlHeight` |
| `var(--size-card-min-width)` | `288px` | `tokens.size.cardMinWidth` |
| `var(--size-drawer-width)` | `560px` | `tokens.size.drawerWidth` |
| `var(--size-drawer-max-width)` | `92vw` | `tokens.size.drawerMaxWidth` |
| `var(--size-content-narrow)` | `980px` | `tokens.size.contentNarrow` |
| `var(--size-content-medium)` | `1100px` | `tokens.size.contentMedium` |
| `var(--size-content-wide)` | `1120px` | `tokens.size.contentWide` |
| `var(--size-form-narrow)` | `420px` | `tokens.size.formNarrow` |
| `var(--size-error-content)` | `680px` | `tokens.size.errorContent` |
| `var(--size-startup-content)` | `640px` | `tokens.size.startupContent` |
| `var(--size-search-board)` | `300px` | `tokens.size.searchBoard` |
| `var(--size-search-contacts)` | `360px` | `tokens.size.searchContacts` |
| `var(--size-search-global)` | `480px` | `tokens.size.searchGlobal` |
| `var(--size-select-small)` | `170px` | `tokens.size.selectSmall` |
| `var(--size-select-medium)` | `180px` | `tokens.size.selectMedium` |
| `var(--size-select-wide)` | `190px` | `tokens.size.selectWide` |
| `var(--size-call-label)` | `120px` | `tokens.size.callLabel` |
| `var(--size-call-input)` | `220px` | `tokens.size.callInput` |
| `var(--size-import-label)` | `170px` | `tokens.size.importLabel` |
| `var(--size-title-slot)` | `180px` | `tokens.size.titleSlot` |
| `var(--size-logo)` | `34px` | `tokens.size.logo` |
| `var(--size-nav-item)` | `44px` | `tokens.size.navItem` |
| `var(--size-nav-icon-slot)` | `38px` | `tokens.size.navIconSlot` |
| `var(--size-stage-dot)` | `12px` | `tokens.size.stageDot` |
| `var(--size-column-dot)` | `9px` | `tokens.size.columnDot` |
| `var(--size-color-button)` | `36px` | `tokens.size.colorButton` |
| `var(--size-column-header)` | `40px` | `tokens.size.columnHeader` |
| `var(--size-column-body)` | `100px` | `tokens.size.columnBody` |
| `var(--size-tag-dot)` | `10px` | `tokens.size.tagDot` |
| `var(--size-tag-menu)` | `240px` | `tokens.size.tagMenu` |
| `var(--size-report-icon)` | `42px` | `tokens.size.reportIcon` |
| `var(--size-progress-bar)` | `8px` | `tokens.size.progressBar` |
| `var(--size-empty-icon)` | `40px` | `tokens.size.emptyIcon` |
| `var(--size-upload-icon)` | `48px` | `tokens.size.uploadIcon` |
| `var(--size-success-icon)` | `56px` | `tokens.size.successIcon` |
| `var(--size-scrollbar)` | `10px` | `tokens.size.scrollbar` |
| `var(--size-excel-column)` | `22px` | `tokens.size.excelColumn` |
| `var(--size-pipeline-step)` | `96px` | `tokens.size.pipelineStep` |
| `var(--size-pipeline-dot)` | `18px` | `tokens.size.pipelineDot` |
| `var(--size-pipeline-ring)` | `28px` | `tokens.size.pipelineRing` |
| `var(--size-pipeline-line)` | `2px` | `tokens.size.pipelineLine` |
| `var(--size-app-loader)` | `300px` | `tokens.size.appLoader` |
| `var(--size-chat-viewport)` | `420px` | `tokens.size.chatViewport` |
| `var(--size-chat-bubble-max)` | `78%` | `tokens.size.chatBubbleMax` |
| `var(--size-zero)` | `0` | `tokens.size.zero` |
| `var(--size-full)` | `100%` | `tokens.size.full` |
| `var(--size-viewport)` | `100vh` | `tokens.size.viewport` |
| `var(--size-board-viewport)` | `calc(100vh - 170px)` | `tokens.size.boardViewport` |
| `var(--size-contacts-viewport)` | `calc(100vh - 180px)` | `tokens.size.contactsViewport` |

| Token | Value | Source |
|-------|-------|--------|
| `var(--inset-card-action)` | `8px` | `tokens.inset.cardAction` |
| `var(--inset-navigation-footer)` | `20px` | `tokens.inset.navigationFooter` |

## Components

Catalogue of everything this product actually renders, plus the icon set.
Material UI first: a project component is justified only when Material UI has no equivalent,
and the file says why. Ready-made components are configured through their own props and
slots (`icon`, `slots`, `slotProps`, `variant`, `size`), never by rewriting their markup.
Icons come from `@mui/icons-material` only.

### Box

Generic layout primitive. Only when no dedicated MUI component fits; styled through `sx` with theme keys and tokens. (MUI)

- `--spacing-md`
- `--radius-md`

### Stack

Default way to lay out siblings. `spacing` maps to the 8px MUI unit, so `spacing={2}` is 16px. (MUI)

- `--spacing-sm`
- `--spacing-lg`

### Paper

Card surface for lead cards and panels. `elevation={0}` by default; depth comes from border and shadow tokens. (MUI)

- `--bg-surface`
- `--color-border`
- `--elevation-card`
- `--elevation-card-hover`

### Divider

Horizontal rule between drawer sections. Colour comes from `divider` in the palette. (MUI)

- `--color-border`

### Collapse

Reveals the optional field block in the contact form. (MUI)

- `--motion-normal`

### Button

Primary and secondary actions. Theme sets `disableElevation`, 40px min height and the 12px radius. (MUI)

- `--size-control-height`
- `--radius-md`
- `--font-size-button`
- `--font-weight-semibold`

### ButtonBase

Click target for the kanban lead card, which is a whole-surface action rather than a labelled button. (MUI)

- `--radius-md`
- `--focus-outline`
- `--focus-offset`

### IconButton

Icon-only action. Theme enforces a 40px square hit area. (MUI)

- `--size-control-height`
- `--icon-size-small`
- `--icon-size-compact`

### Tooltip

Label for icon-only actions. A disabled button inside a Tooltip is the one place a raw `span` wrapper is allowed. (MUI)

- `--font-size-body2`

### TextField

All free-text and numeric input. Theme defaults to `size="small"`. (MUI)

- `--size-control-height`
- `--radius-md`
- `--font-size-body1`

### InputAdornment

Leading or trailing affordance inside a TextField, such as the copy-phone action. (MUI)

- `--icon-size-compact`

### Checkbox

Multi-select of tags in the tag popover. (MUI)

- `--color-brand`

### Switch

Boolean custom field in the contact form. (MUI)

- `--color-brand`

### Select

Bound choice for sort order and filters. (MUI)

- `--size-select-small`
- `--size-select-medium`
- `--size-select-wide`

### MenuItem

Option inside Select, Menu and Autocomplete lists. (MUI)

- `--font-size-body1`

### Menu

Anchored action list, used for the priority picker. (MUI)

- `--radius-md`
- `--elevation-floating`

### Popover

Anchored surface for the tag editor. (MUI)

- `--size-tag-menu`
- `--radius-md`
- `--elevation-floating`

### FormControlLabel

Pairs Checkbox or Switch with its label. (MUI)

- `--font-size-body2`

### Alert

Inline error and empty-state messaging inside dialogs and the drawer. (MUI)

- `--color-danger`
- `--color-danger-soft`
- `--color-warning`
- `--color-warning-soft`
- `--color-success`
- `--color-success-soft`

### Snackbar

Transient confirmation, wrapped by the shared Toast component. (MUI)

- `--elevation-floating`
- `--radius-md`

### CircularProgress

Pending state on a submitting dialog or drawer. (MUI)

- `--color-brand`

### LinearProgress

Determinate progress for import and backup. (MUI)

- `--size-progress-bar`
- `--radius-pill`

### Typography

Every piece of text. Variant carries the size and weight; no ad-hoc `fontSize`. (MUI)

- `--font-family`
- `--font-size-h1`
- `--line-height-h1`
- `--letter-spacing-h1`
- `--font-size-h2`
- `--line-height-h2`
- `--letter-spacing-h2`
- `--font-size-subtitle1`
- `--font-size-body1`
- `--line-height-body1`
- `--font-size-body2`
- `--line-height-body2`
- `--text-primary`
- `--text-secondary`

### Chip

Tag, stage and priority badges. Theme sets the 8px radius and the navigation weight. (MUI)

- `--radius-sm`
- `--font-weight-navigation`
- `--color-brand-soft`

### Badge

Numeric overlay on navigation and reminder icons. (MUI)

- `--color-danger`

### List

Vertical option list; use it instead of stacking Box rows. (MUI)

- `--spacing-xs`

### ListItemButton

Selectable row in the tag popover and the side navigation. (MUI)

- `--size-nav-item`
- `--radius-sm`

### ListItemIcon

Icon slot of a list row. (MUI)

- `--size-nav-icon-slot`

### ListItemText

Primary and secondary text of a list row. (MUI)

- `--font-size-body1`
- `--font-size-body2`

### Stepper

Stage pipeline of a contact. Chosen over a hand-built progress bar because MUI already models steps. (MUI)

- `--size-pipeline-step`
- `--size-pipeline-line`

### Step

One stage inside the Stepper. (MUI)

- `--size-pipeline-dot`
- `--size-pipeline-ring`

### StepLabel

Stage caption; the dot is supplied through the `StepIconComponent` slot. (MUI)

- `--font-size-body2`
- `--font-weight-navigation`

### Tabs

Section switcher on the reports and settings pages. (MUI)

- `--font-weight-navigation`

### Tab

One tab inside Tabs. (MUI)

- `--font-size-body1`

### AppBar

Application top bar. (MUI)

- `--size-topbar-height`
- `--color-surface-glass`
- `--effect-glass-blur`

### Toolbar

Row inside AppBar. (MUI)

- `--size-topbar-height`
- `--spacing-lg`

### Dialog

Modal for adding a contact and for destructive confirmation. Theme sets the 18px paper radius. (MUI)

- `--radius-lg`
- `--size-form-narrow`

### DialogTitle

Dialog heading. (MUI)

- `--font-size-h2`
- `--font-weight-bold`

### DialogContent

Dialog body. (MUI)

- `--spacing-lg`

### DialogActions

Dialog action row, confirming action last. (MUI)

- `--spacing-sm`

### TableContainer

Scroll container for the contacts table. (MUI)

- `--size-contacts-viewport`

### Table

Contacts and import preview tables. (MUI)

- `--font-size-body2`

### TableHead

Table header row group. (MUI)

- `--bg-subtle`

### TableBody

Table data row group. (MUI)

- `--bg-surface`

### TableRow

One table row. (MUI)

- `--color-border`

### TableCell

One table cell. (MUI)

- `--spacing-sm`
- `--spacing-md`

### TableSortLabel

Sortable column header. (MUI)

- `--font-weight-navigation`

### TablePagination

Pager under the contacts table. (MUI)

- `--font-size-body2`

### AppShell

Application frame: side navigation, top bar and routed outlet. No MUI equivalent composes the whole layout. (project)

- `--size-nav-width`
- `--size-nav-compact-width`
- `--size-topbar-height`
- `--size-logo`
- `--size-content-narrow`
- `--size-content-medium`
- `--size-content-wide`
- `--inset-navigation-footer`
- `--font-weight-logo`

### Toast

Single notification host over Snackbar and Alert, so severity icons stay consistent across the app. (project)

- `--color-success`
- `--color-danger`
- `--color-warning`
- `--color-brand`

### PageLoader

Suspense fallback for lazily routed pages. (project)

- `--size-app-loader`

### LeadCard

Kanban card for one lead. Built on Paper plus ButtonBase because MUI has no card-as-single-action component. (project)

- `--size-card-min-width`
- `--inset-card-action`
- `--elevation-card`
- `--elevation-card-hover`
- `--motion-fast`

### KanbanColumn

One board column with its drop zone. Drag and drop comes from dnd-kit, which MUI does not cover. (project)

- `--size-column-header`
- `--size-column-body`
- `--size-column-dot`
- `--size-board-viewport`
- `--bg-subtle`

### ContactDrawer

Contact detail composition. Currently rendered as a full-width MUI Dialog; the drawer sizes and the MuiDrawer theme override are reserved for it. (project)

- `--size-drawer-width`
- `--size-drawer-max-width`
- `--spacing-lg`

### ContactFields

Editable field block of a contact, including custom fields. (project)

- `--size-title-slot`
- `--spacing-md`

### CustomFieldsEditor

Editor for user-defined contact fields. (project)

- `--size-form-narrow`
- `--spacing-sm`

### EditableTitle

Click-to-edit heading. MUI has no inline-edit component. (project)

- `--font-size-h2`
- `--font-weight-bold`
- `--size-control-height`

### StagePipeline

Stage progression built on Stepper with a custom dot slot. (project)

- `--size-pipeline-step`
- `--size-pipeline-dot`
- `--size-pipeline-ring`
- `--size-pipeline-line`
- `--stage-1`
- `--stage-2`
- `--stage-3`
- `--stage-4`
- `--stage-5`
- `--stage-6`

### StageDotButton

Step icon slot of StagePipeline: a stage dot that is also the control that moves the lead. (project)

- `--size-stage-dot`
- `--focus-outline`
- `--focus-offset`

### PrioritySelect

Priority picker over Menu, showing the colour dot alongside the label. (project)

- `--size-select-small`
- `--radius-pill`

### PriorityDot

Colour marker of a priority. Never the only carrier of meaning: it always sits next to its label. (project)

- `--size-tag-dot`
- `--radius-round`

### TagBar

Tag row with an attached editor popover. (project)

- `--size-tag-menu`
- `--spacing-xs`

### TagDot

Colour marker of a tag, always paired with the tag name. (project)

- `--size-tag-dot`
- `--radius-round`
- `--size-color-button`

### LeadChat

Message and event timeline of a lead. (project)

- `--size-chat-viewport`
- `--size-chat-bubble-max`
- `--spacing-sm`

### MessageBubble

One chat message. (project)

- `--radius-lg`
- `--bg-subtle`
- `--color-brand-soft`
- `--font-size-body2`

### EventRow

One system event in the lead timeline. (project)

- `--text-secondary`
- `--font-size-body2`

### AddContactDialog

Create-contact form inside a MUI Dialog. (project)

- `--size-form-narrow`
- `--spacing-md`

### AppErrorBoundary

Top-level error surface. (project)

- `--size-error-content`
- `--color-danger`
- `--size-empty-icon`

### AccessTimeOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### Add

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### ArrowBack

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### ArrowDownward

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### ArrowDropDown

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### ArrowUpward

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### AssessmentOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### BackupOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### CalendarTodayOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### ChatBubbleOutline

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### CheckCircleOutline

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### CheckCircleOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### Close

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### CloudUploadOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### ContentCopyOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### DashboardOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### DeleteOutline

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### DescriptionOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### DownloadOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### EditOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### ErrorOutline

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### EventRepeatOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### ExpandMore

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### FileDownloadOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### FileUploadOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### FilterAltOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### FilterListOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### GroupsOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### InfoOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### MoreHoriz

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### NotificationsNoneOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### OpenInNewOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### PersonAddAlt1Outlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### PhoneMissedOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### PhoneOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### SaveOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### Search

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### SendOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### SettingsOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### SwapVert

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### TuneOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### UploadOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

### WarningAmberOutlined

Icon from `@mui/icons-material`.

- `--icon-size-small`
- `--icon-size-compact`

## Elevation

Depth is a two-step scale plus one floating level. `MuiPaper` defaults to `elevation={0}`,
so surfaces are separated by `var(--color-border)` and gain shadow only when they lift.

| Token | Value | Source |
|-------|-------|--------|
| `var(--elevation-card)` | `0 1px 2px rgba(23, 32, 51, 0.06)` | `tokens.elevation.card` |
| `var(--elevation-card-hover)` | `0 8px 22px rgba(23, 32, 51, 0.09)` | `tokens.elevation.cardHover` |
| `var(--elevation-floating)` | `0 18px 48px rgba(23, 32, 51, 0.16)` | `tokens.elevation.floating` |

## Motion

| Token | Value | Source |
|-------|-------|--------|
| `var(--motion-fast)` | `140ms ease` | `tokens.motion.fast` |
| `var(--motion-normal)` | `220ms ease` | `tokens.motion.normal` |

`prefers-reduced-motion: reduce` collapses transitions and animations to 0.01ms in
`src/app/styles/global.css`.

| Token | Value | Source |
|-------|-------|--------|
| `var(--focus-outline)` | `3px solid` | `tokens.focus.outline` |
| `var(--focus-offset)` | `-3px` | `tokens.focus.offset` |

| Token | Value | Source |
|-------|-------|--------|
| `var(--effect-glass-blur)` | `blur(14px)` | `tokens.effect.glassBlur` |
| `var(--effect-scrollbar-border)` | `3px solid transparent` | `tokens.effect.scrollbarBorder` |

## Anti-Patterns

- Building an interface out of `Box`, `ButtonBase` and `sx` when Material UI already ships
  the component: `Stepper`, `Autocomplete`, `Accordion`, `Tabs`, `Badge`, `List`,
  `Skeleton` and the rest.
- Rewriting a ready-made component's markup instead of using its props and slots.
- Raw HTML tags inside components. The only exception is the `span` wrapper Material UI
  itself requires around a disabled button inside a `Tooltip`.
- Literal HEX or RGB values in components. Colour comes from the theme palette or from data.
- Literal numbers for `width`, `height`, `borderRadius`, `fontWeight` or `fontSize` in
  `sx`. Add a key to `tokens` instead.
- A middle-dot separator in interface copy. Parts of a string are separated by a comma.
- Patching theme-level styling inside individual components instead of
  `src/shared/design-system/`.
- Shipping an action without its loading, empty, error and success states.
- Carrying meaning with colour alone, or removing the visible focus ring.
