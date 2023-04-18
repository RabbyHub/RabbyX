import { permissionService } from 'background/service';
import PortMessage from '@/utils/message/portMessage';
import RabbyXPortMessage from '@/utils/message/RabbyxPortMessage';

export interface SessionProp {
  origin: string;
  icon: string;
  name: string;
}

export class Session {
  origin = '';

  icon = '';

  name = '';

  pm: PortMessage | null = null;
  rpm: RabbyXPortMessage | null = null;

  constructor(data?: SessionProp | null) {
    if (data) {
      this.setProp(data);
    }
  }

  setPortMessage(pm: PortMessage) {
    this.pm = pm;
  }

  pushMessage(event: string, data: any, origin?: string) {
    this.pm?.send('message', { event, data, origin });
  }

  setRabbyXPortMessage(rpm: RabbyXPortMessage) {
    this.rpm = rpm;
  }

  pushRabbyXMessage(event: string, data: any, origin?: string) {
    this.rpm?.send('message', { event, data, origin });
  }

  setProp({ origin, icon, name }: SessionProp) {
    this.origin = origin;
    this.icon = icon;
    this.name = name;
  }
}

// for each tab
const sessionMap = new Map<string, Session | null>();

const getSessionMap = () => {
  return sessionMap;
};

const getSession = (key: string) => {
  return sessionMap.get(key);
};

const getOrCreateSession = (id: number, origin: string) => {
  if (sessionMap.has(`${id}-${origin}`)) {
    return getSession(`${id}-${origin}`);
  }

  return createSession(`${id}-${origin}`, null);
};

const createSession = (key: string, data?: null | SessionProp) => {
  const session = new Session(data);
  sessionMap.set(key, session);
  broadcastToDesktopOnly('createSession', key);

  return session;
};

const deleteSession = (key: string) => {
  sessionMap.delete(key);
};

const broadcastToDesktopOnly = (event: string, data?: any, origin?: string) => {
  sessionMap.forEach((session, key) => {
    if (!session?.rpm) return ;

    session?.pushRabbyXMessage?.(event, data, origin);
  });

  // deprecated pattern, never rely on this
  window.rabbyDesktop?.ipcRenderer.sendMessage(
    '__internal_rpc:rabbyx:on-session-broadcast',
    {
      event,
      data,
      origin,
    }
  );
};

const broadcastEvent = (ev: string, data?: any, origin?: string) => {
  broadcastToDesktopOnly(ev, data, origin);
  let sessions: { key: string; data: Session }[] = [];
  sessionMap.forEach((session, key) => {
    if (session && permissionService.hasPermission(session.origin)) {
      sessions.push({
        key,
        data: session,
      });
    }
  });

  // same origin
  if (origin) {
    sessions = sessions.filter((session) => session.data.origin === origin);
  }

  sessions.forEach((session) => {
    try {
      session.data.pushMessage?.(ev, data, origin);
    } catch (e) {
      if (sessionMap.has(session.key)) {
        deleteSession(session.key);
      }
    }
  });
};

export default {
  getSessionMap,
  getSession,
  getOrCreateSession,
  deleteSession,
  broadcastEvent,
  broadcastToDesktopOnly,
};
