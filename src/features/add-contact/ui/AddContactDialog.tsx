import { useState } from 'react';
import { PersonAddAlt1Outlined } from '@mui/icons-material';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import { createLeadCard } from '../../../entities/lead/model/lead-service';
import { db } from '../../../infrastructure/database/database';

interface AddContactDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (leadId: string) => void;
}

const EMPTY_FORM = { organization: '', personName: '', phone: '', email: '', region: '', assignee: 'Я' };

export function AddContactDialog({ open, onClose, onCreated }: AddContactDialogProps) {
  const stages = useLiveQuery(() => db.stages.filter((stage) => !stage.archived).sortBy('order'), []);
  const [form, setForm] = useState(EMPTY_FORM);
  const [stageId, setStageId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const currentStageId = stageId || stages?.[0]?.id || '';
  const filled = Boolean(form.organization.trim() || form.personName.trim() || form.phone.trim());

  function close() {
    setForm(EMPTY_FORM); setStageId(''); setError('');
    onClose();
  }

  async function submit(): Promise<void> {
    if (!filled || !currentStageId || busy) return;
    setBusy(true); setError('');
    try {
      const leadId = await createLeadCard(
        { organization: form.organization.trim(), personName: form.personName.trim(), phone: form.phone.trim(), email: form.email.trim(), region: form.region.trim() },
        { result: '', description: '', assignee: form.assignee.trim() || 'Я' },
        currentStageId,
      );
      close();
      onCreated(leadId);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Не удалось добавить контакт. Повторите ещё раз.');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="add-contact-title">
      <DialogTitle id="add-contact-title">Добавить контакт</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
        <Stack gap={2} mt={1}>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}>
            <TextField fullWidth label="Организация" value={form.organization} onChange={(event) => setForm({ ...form, organization: event.target.value })} />
            <TextField fullWidth label="Контактное лицо" value={form.personName} onChange={(event) => setForm({ ...form, personName: event.target.value })} />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}>
            <TextField fullWidth label="Телефон" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            <TextField fullWidth label="E-mail" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}>
            <TextField fullWidth label="Регион" value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} />
            <TextField fullWidth label="Ответственный" value={form.assignee} onChange={(event) => setForm({ ...form, assignee: event.target.value })} />
          </Stack>
          <TextField select fullWidth label="Этап" value={currentStageId} onChange={(event) => setStageId(event.target.value)}>
            {(stages ?? []).map((stage) => <MenuItem key={stage.id} value={stage.id}>{stage.name}</MenuItem>)}
          </TextField>
          {!filled && <Alert severity="info">Заполните организацию, контактное лицо или телефон.</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>Отмена</Button>
        <Button variant="contained" startIcon={busy ? <CircularProgress size={16} /> : <PersonAddAlt1Outlined />} disabled={!filled || !currentStageId || busy} onClick={() => void submit()}>
          Добавить
        </Button>
      </DialogActions>
    </Dialog>
  );
}
