import { Box, IconButton, Step, StepLabel, Stepper } from '@mui/material';
import { tokens } from '../../../shared/design-system/tokens';
import type { Stage } from '../../../shared/model/domain';

interface StagePipelineProps {
  stages: Stage[];
  currentStageId: string;
  disabled: boolean;
  onSelect: (stageId: string) => void;
}

interface StageDotButtonProps {
  name: string;
  color: string;
  muted: boolean;
  current: boolean;
  disabled: boolean;
  onSelect: () => void;
}

// Кликабелен только кружок, поэтому кнопка ужата до размера кольца (p: 0), а подпись
// шага остаётся обычным текстом StepLabel. Цвет кружка приходит из настроек этапа.
// Визуальной подписи внутри кнопки нет, отсюда обязательные aria-label и aria-current.
function StageDotButton({ name, color, muted, current, disabled, onSelect }: StageDotButtonProps) {
  return (
    <IconButton
      disabled={disabled}
      aria-label={`Этап: ${name}`}
      aria-current={current ? 'step' : undefined}
      onClick={onSelect}
      sx={{
        p: 0,
        width: tokens.size.pipelineRing,
        height: tokens.size.pipelineRing,
        minWidth: tokens.size.pipelineRing,
        minHeight: tokens.size.pipelineRing,
        border: '2px solid',
        borderColor: current ? color : 'transparent',
        '&:focus-visible': { outline: tokens.focus.outline, outlineColor: 'primary.light' },
      }}
    >
      <Box sx={{ width: tokens.size.pipelineDot, height: tokens.size.pipelineDot, borderRadius: tokens.radiusCss.round, bgcolor: muted ? 'action.disabled' : color }} />
    </IconButton>
  );
}

// Прокрутки нет ни по одной оси: шаги ужимаются, длинные названия переносятся
// и обрезаются на второй строке, поэтому высота пайплайна остаётся постоянной.
const PIPELINE_SX = {
  '& .MuiStep-root': { minWidth: tokens.size.zero, px: 0.5 },
  '& .MuiStepLabel-label': { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' },
} as const;

export function StagePipeline({ stages, currentStageId, disabled, onSelect }: StagePipelineProps) {
  if (stages.length === 0) return null;
  const currentIndex = stages.findIndex((stage) => stage.id === currentStageId);

  return (
    <Stepper nonLinear alternativeLabel activeStep={currentIndex} sx={PIPELINE_SX}>
      {stages.map((stage, index) => (
        <Step key={stage.id} completed={index < currentIndex}>
          <StepLabel
            icon={(
              <StageDotButton
                name={stage.name}
                color={stage.color}
                muted={index > currentIndex}
                current={index === currentIndex}
                disabled={disabled}
                onSelect={() => onSelect(stage.id)}
              />
            )}
          >
            {stage.name}
          </StepLabel>
        </Step>
      ))}
    </Stepper>
  );
}
