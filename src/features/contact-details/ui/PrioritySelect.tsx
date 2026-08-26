import { useRef, useState } from 'react';
import { ArrowDropDown } from '@mui/icons-material';
import { Box, Chip, Menu, MenuItem, Stack } from '@mui/material';
import { tokens } from '../../../shared/design-system/tokens';
import { PRIORITY_LABELS } from '../../../entities/lead/model/lead-service';
import type { LeadPriority } from '../../../shared/model/domain';

// Цвет — только подсказка: подпись приоритета видна всегда.
const PRIORITY_COLORS: Record<LeadPriority, string> = { low: 'text.secondary', normal: 'warning.main', high: 'error.main' };

const PRIORITIES: LeadPriority[] = ['high', 'normal', 'low'];

interface PrioritySelectProps {
  value: LeadPriority;
  disabled: boolean;
  onChange: (value: LeadPriority) => void;
}

function PriorityDot({ priority, className }: { priority: LeadPriority; className?: string }) {
  return <Box className={className} sx={{ bgcolor: PRIORITY_COLORS[priority], borderRadius: tokens.radiusCss.round, width: tokens.size.tagDot, height: tokens.size.tagDot, flexShrink: 0 }} />;
}

export function PrioritySelect({ value, disabled, onChange }: PrioritySelectProps) {
  const chipRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // Ref читается только в обработчике: во время рендера MUI ещё не проставил его,
  // да и React такое чтение запрещает. Якорь для обоих входов в меню один и тот же.
  const openMenu = () => setAnchor(chipRef.current);

  return (
    <>
      <Chip
        ref={chipRef}
        size="small"
        variant="outlined"
        label={PRIORITY_LABELS[value]}
        icon={<PriorityDot priority={value} />}
        disabled={disabled}
        skipFocusWhenDisabled
        aria-label="Приоритет заявки"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={openMenu}
        // Слот deleteIcon — штатное место замыкающей иконки чипа. Здесь это стрелка
        // меню, поэтому обработчик открывает меню, а не удаляет чип.
        deleteIcon={<ArrowDropDown />}
        onDelete={openMenu}
      />
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {PRIORITIES.map((priority) => (
          <MenuItem
            key={priority}
            selected={priority === value}
            onClick={() => { setAnchor(null); onChange(priority); }}
          >
            <Stack direction="row" alignItems="center" gap={1}>
              <PriorityDot priority={priority} />
              {PRIORITY_LABELS[priority]}
            </Stack>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
