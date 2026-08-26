import { useCallback, useEffect, useRef, useState } from 'react';
import { EditOutlined, Search, SendOutlined } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material';
import { describeBridgeError, searchRecipient, sendProposal, type MaxSendResult } from '../../max-bridge/model/max-bridge';
import { recordProposalSent } from '../model/proposal-service';

interface SendProposalDialogProps {
  leadId: string;
  phone: string;
  onClose: () => void;
}

type Lookup =
  /** Поиск ещё не дал результата: подсказку показывает общее сообщение об ошибке. */
  | { kind: 'none' }
  | { kind: 'empty' }
  | { kind: 'found'; recipient: string }
  | { kind: 'missing' };

function LookupNotice({ lookup, searching }: { lookup: Lookup; searching: boolean }) {
  if (searching) return <Alert severity="info" icon={<CircularProgress size={16} />}>Ищем получателя в MAX…</Alert>;
  if (lookup.kind === 'found') return <Alert severity="success">Получатель в MAX: {lookup.recipient}</Alert>;
  if (lookup.kind === 'missing') return <Alert severity="warning">В MAX такой номер не найден. Укажите другой номер через карандаш и повторите поиск.</Alert>;
  if (lookup.kind === 'empty') return <Alert severity="info">Введите номер телефона, чтобы найти получателя.</Alert>;
  return null;
}

function SendOutcomeNotice({ result, onRetry }: { result: MaxSendResult; onRetry: () => void }) {
  if (result.delivered) return <Alert severity="success">Отправлено в MAX, получатель {result.recipient}. {result.detail}</Alert>;
  // Для неизвестного статуса кнопки повтора нет намеренно: сообщение могло уже
  // уйти, и повторная отправка создала бы дубль у получателя.
  if (result.uncertain) return <Alert severity="warning">Статус доставки неизвестен ({result.status}). Сообщение могло уже уйти, повторная отправка вручную создаст дубль. Проверьте переписку в MAX. {result.detail}</Alert>;
  return <Alert severity="info" action={<Button color="inherit" onClick={onRetry}>Отправить снова</Button>}>Сообщение не отправлено ({result.status}). {result.detail}</Alert>;
}

export function SendProposalDialog({ leadId, phone, onClose }: SendProposalDialogProps) {
  const [phoneValue, setPhoneValue] = useState(phone);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [lookup, setLookup] = useState<Lookup>({ kind: 'none' });
  const [outcome, setOutcome] = useState<MaxSendResult | null>(null);
  const [busy, setBusy] = useState<'search' | 'send' | null>(null);
  const [error, setError] = useState('');
  // Ref, а не состояние: guard от наложения запросов не должен менять
  // идентичность `search` и перезапускать эффект.
  const running = useRef(false);

  const search = useCallback(async (value: string): Promise<void> => {
    const query = value.trim();
    setError('');
    if (!query) { setLookup({ kind: 'empty' }); return; }
    if (running.current) return;
    running.current = true;
    setBusy('search'); setLookup({ kind: 'none' });
    try {
      const result = await searchRecipient(query);
      setLookup(result.found ? { kind: 'found', recipient: result.recipient } : { kind: 'missing' });
    } catch (searchError) {
      setLookup({ kind: 'none' });
      setError(describeBridgeError(searchError));
    } finally {
      running.current = false;
      setBusy(null);
    }
  }, []);

  // Номер берётся из карточки и сразу ищется в MAX, чтобы оператор видел
  // получателя до того, как напишет текст. Поиск ставится в очередь, а не
  // выполняется в теле эффекта: иначе первый рендер сразу тянет за собой второй.
  useEffect(() => {
    const timer = setTimeout(() => { void search(phone); });
    return () => { clearTimeout(timer); };
  }, [phone, search]);

  const message = text.trim();
  const canSend = message !== '' && phoneValue.trim() !== '' && busy === null && lookup.kind !== 'missing' && !(outcome?.uncertain ?? false);

  async function submit(): Promise<void> {
    if (!canSend || running.current) return;
    running.current = true;
    setBusy('send'); setError(''); setOutcome(null);
    try {
      const result = await sendProposal(phoneValue.trim(), message);
      setOutcome(result);
      if (result.delivered || result.uncertain) {
        await recordProposalSent(leadId, { recipient: result.recipient, phone: phoneValue.trim(), uncertain: result.uncertain });
      }
    } catch (sendError) {
      setError(describeBridgeError(sendError));
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="send-proposal-title">
      <DialogTitle id="send-proposal-title">Отправить КП в MAX</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" disabled={busy !== null} onClick={() => void search(phoneValue)}>Повторить</Button>}>{error}</Alert>}
        <Stack gap={2} mt={1}>
          <TextField
            fullWidth
            label="Телефон получателя"
            value={phoneValue}
            onChange={(event) => { setPhoneValue(event.target.value); setOutcome(null); }}
            helperText={editing ? 'К формату MAX номер приводит мост, вводите как удобно.' : 'Номер из карточки. Нажмите карандаш, чтобы указать другой.'}
            slotProps={{ input: {
              readOnly: !editing,
              endAdornment: (
                <InputAdornment position="end">
                  {editing
                    ? <Tooltip title="Найти в MAX"><Box component="span"><IconButton size="small" aria-label="Найти получателя в MAX" color="primary" disabled={busy !== null || phoneValue.trim() === ''} onClick={() => void search(phoneValue)}><Search fontSize="small" /></IconButton></Box></Tooltip>
                    : <Tooltip title="Изменить номер"><Box component="span"><IconButton size="small" aria-label="Изменить номер" disabled={busy !== null} onClick={() => setEditing(true)}><EditOutlined fontSize="small" /></IconButton></Box></Tooltip>}
                </InputAdornment>
              ),
            } }}
          />
          <LookupNotice lookup={lookup} searching={busy === 'search'} />
          <TextField
            fullWidth
            multiline
            minRows={4}
            label="Сообщение"
            value={text}
            onChange={(event) => { setText(event.target.value); setOutcome(null); }}
          />
          {message === '' && <Alert severity="info">Напишите текст сообщения, без него отправка недоступна.</Alert>}
          {outcome && <SendOutcomeNotice result={outcome} onRetry={() => void submit()} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy !== null}>Закрыть</Button>
        <Button
          variant="contained"
          startIcon={busy === 'send' ? <CircularProgress size={16} /> : <SendOutlined />}
          disabled={!canSend}
          onClick={() => void submit()}
        >
          {busy === 'send' ? 'Отправка…' : 'Отправить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
