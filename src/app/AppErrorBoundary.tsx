import { Component, type ReactNode } from 'react';
import { Alert, Box, Button } from '@mui/material';
import { tokens } from '../shared/design-system/tokens';

interface Props { children: ReactNode }
interface State { failed: boolean }

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <Box sx={{ p: 4, maxWidth: tokens.size.errorContent }}><Alert severity="error" action={<Button color="inherit" onClick={() => window.location.reload()}>Перезапустить</Button>}>Произошла ошибка интерфейса. Данные остались в локальной базе.</Alert></Box>;
    }
    return this.props.children;
  }
}
