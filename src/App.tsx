import _, { useEffect, useMemo, useRef, useState } from 'react';

const CHAT_API = 'http://localhost:8080';
const NOTIFICATION_API = 'ws://localhost:8081';
const USER_API = 'http://localhost:8082';

type User = {
  id: string;
  email: string;
  username: string;
  display_name: string;
  status: number;
};

type Chat = {
  id: string;
  participant_ids: string[];
};

type Message = {
  id: string;
  sender_id: string;
  chat_id: string;
  text: string;
  created_at?: string;
};

type LoginResponse = {
  access_token: string;
  refresh_token: string;
};

function decodeWsPayload(raw: string) {
  const cleaned = raw.replace(/"/g, '');
  const decoded = atob(cleaned);
  return JSON.parse(decoded);
}

export default function App() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [messageText, setMessageText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const currentMessages = useMemo(() => {
    if (!currentChatId) return [];
    return messagesByChat[currentChatId] || [];
  }, [messagesByChat, currentChatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages]);

  async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers || {}),
      },
      credentials: 'include',
    });

    if (!res.ok) {
      throw new Error(`Request failed: ${res.status}`);
    }

    return res.json();
  }

  async function login() {
    const data = await apiFetch<LoginResponse>(`${USER_API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    setAccessToken(data.access_token);
  }

  useEffect(() => {
    if (!accessToken) return;

    (async () => {
      const tokenPayload = JSON.parse(atob(accessToken.split('.')[1]));
      const myUserId = tokenPayload.sub as string;

      const userResp = await apiFetch<{ users: User[] }>(`${USER_API}/users?user_ids=${myUserId}`);
      const currentUser = userResp.users[0];
      setMe(currentUser);

      const chatResp = await apiFetch<{ chats: Chat[] }>(`${CHAT_API}/chats`);
      setChats(chatResp.chats);

      const participantIds = [...new Set(chatResp.chats.flatMap(c => c.participant_ids))];
      if (participantIds.length) {
        const qs = participantIds.map(id => `user_ids=${id}`).join('&');
        const usersResp = await apiFetch<{ users: User[] }>(`${USER_API}/users?${qs}`);
        const map: Record<string, User> = {};
        usersResp.users.forEach(u => (map[u.id] = u));
        setUsers(map);
      }

      const ws = new WebSocket(`${NOTIFICATION_API}/ws?token=${accessToken}`);

      ws.onmessage = event => {
        try {
          const data = decodeWsPayload(event.data);
          if (data.type === 'new_message') {
            const msg: Message = data.payload;
            setMessagesByChat(prev => ({
              ...prev,
              [msg.chat_id]: [...(prev[msg.chat_id] || []), msg],
            }));
          }
        } catch (e) {
          console.error('WS parse error', e);
        }
      };

      return () => ws.close();
    })();
  }, [accessToken]);

  async function openChat(chatId: string) {
    setCurrentChatId(chatId);

    if (messagesByChat[chatId]) return;

    const resp = await apiFetch<{ messages: Message[] }>(`${CHAT_API}/messages?chat_id=${chatId}`);

    setMessagesByChat(prev => ({
      ...prev,
      [chatId]: resp.messages,
    }));
  }

  async function sendMessage() {
    if (!currentChatId || !messageText.trim() || !me) return;

    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      sender_id: me.id,
      chat_id: currentChatId,
      text: messageText,
      created_at: new Date().toISOString(),
    };

    setMessagesByChat(prev => ({
      ...prev,
      [currentChatId]: [...(prev[currentChatId] || []), optimistic],
    }));

    const text = messageText;
    setMessageText('');

    try {
      await apiFetch(`${CHAT_API}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          chat_id: currentChatId,
          text,
        }),
      });
    } catch (e) {
      console.error('Failed to send message', e);
    }
  }

  if (!accessToken) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl bg-slate-900 p-8 shadow-2xl space-y-4">
          <h1 className="text-2xl font-bold">Chatterbox Login</h1>
          <input className="w-full rounded-xl bg-slate-800 p-3" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="w-full rounded-xl bg-slate-800 p-3" placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          <button className="w-full rounded-xl bg-blue-600 p-3 font-semibold" onClick={login}>Login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-950 text-white flex">
      <aside className="w-80 border-r border-slate-800 bg-slate-900 p-4 overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Chats</h2>
        <div className="space-y-2">
          {chats.map(chat => {
            const otherParticipant = chat.participant_ids.find(id => id !== me?.id);
            const title = users[otherParticipant || '']?.display_name || chat.id;

            return (
              <button
                key={chat.id}
                onClick={() => openChat(chat.id)}
                className={`w-full text-left rounded-2xl p-3 transition ${currentChatId === chat.id ? 'bg-blue-600' : 'bg-slate-800 hover:bg-slate-700'}`}
              >
                {title}
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex-1 flex flex-col">
        <div className="border-b border-slate-800 p-4 font-semibold">
          {currentChatId ? 'Conversation' : 'Select a chat'}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {currentMessages.map(msg => {
            const mine = msg.sender_id === me?.id;
            return (
              <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-lg rounded-2xl px-4 py-2 ${mine ? 'bg-blue-600' : 'bg-slate-800'}`}>
                  <div className="text-sm opacity-70 mb-1">
                    {mine ? 'You' : users[msg.sender_id]?.display_name || msg.sender_id}
                  </div>
                  <div>{msg.text}</div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {currentChatId && (
          <div className="border-t border-slate-800 p-4 flex gap-3">
            <input
              className="flex-1 rounded-2xl bg-slate-800 p-3"
              placeholder="Type a message..."
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
            />
            <button className="rounded-2xl bg-blue-600 px-5 font-semibold" onClick={sendMessage}>
              Send
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
