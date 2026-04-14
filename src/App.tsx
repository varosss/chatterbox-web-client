import { useEffect, useMemo, useRef, useState } from 'react';

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
  display_name: string;
};

type Message = {
  id: string;
  sender_id: string;
  chat_id: string;
  text: string;
  created_at?: string;
};

function decodeWsPayload(raw: string) {
  const cleaned = raw.replace(/"/g, '');
  const decoded = atob(cleaned);
  return JSON.parse(decoded);
}

export default function App() {
  const [me, setMe] = useState<User | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messageText, setMessageText] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [showCreateChat, setShowCreateChat] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [newChatName, setNewChatName] = useState('');

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
        ...(init?.headers || {}),
      },
      credentials: 'include',
    });

    if (!res.ok) {
      if (res.status === 401) {
        setMe(null);
        throw new Error('Unauthorized');
      }
      throw new Error(`Request failed: ${res.status}`);
    }

    if (res.status === 204) return {} as T;
    return res.json();
  }

  async function fetchCurrentUser(): Promise<User> {
    const res = await fetch(`${USER_API}/users/me`, {
      method: 'GET',
      credentials: 'include',
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error('Unauthorized');
      throw new Error(`Failed to fetch /me: ${res.status}`);
    }

    return res.json();
  }

  async function loadAppData() {
    setIsLoading(true);
    try {
      const currentUser = await fetchCurrentUser();
      setMe(currentUser);

      const usersResp = await apiFetch<{ users: User[] }>(`${USER_API}/users?limit=500&offset=0`);
      const userMap: Record<string, User> = {};
      usersResp.users.forEach((u) => (userMap[u.id] = u));
      setUsers(userMap);

      const chatResp = await apiFetch<{ chats: Chat[] }>(`${CHAT_API}/chats`);
      setChats(chatResp.chats);
    } catch (err) {
      console.error('Failed to load app data', err);
      setMe(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadAppData();
  }, []);

  async function handleAuth() {
    try {
      if (isLoginMode) {
        await apiFetch(`${USER_API}/login`, {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
      } else {
        await apiFetch(`${USER_API}/register`, {
          method: 'POST',
          body: JSON.stringify({
            email,
            username: username || email.split('@')[0],
            display_name: displayName || username || email.split('@')[0],
            password,
          }),
        });

        await apiFetch(`${USER_API}/login`, {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
      }

      await loadAppData();
    } catch (err) {
      console.error(err);
      alert(isLoginMode ? 'Login failed. Please check your credentials.' : 'Registration failed.');
    }
  }

  async function logout() {
    try {
      await apiFetch(`${USER_API}/logout`, { method: 'POST' });
    } catch (e) {}
    setMe(null);
    setChats([]);
    setUsers({});
    setMessagesByChat({});
    setCurrentChatId(null);
  }

  async function createChat() {
    if (selectedUsers.length === 0 || !me) return;

    const participants = [...new Set([me.id, ...selectedUsers])];

    const body: any = { participants };

    if (participants.length > 2 && newChatName.trim()) {
      body.display_name = newChatName.trim();
    }

    try {
      const { id } = await apiFetch<{ id: string }>(`${CHAT_API}/chats`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const chatResp = await apiFetch<{ chats: Chat[] }>(`${CHAT_API}/chats`);
      setChats(chatResp.chats);

      setShowCreateChat(false);
      setSelectedUsers([]);
      setNewChatName('');
      setCurrentChatId(id);
    } catch (err) {
      console.error('Failed to create chat', err);
      alert('Failed to create chat');
    }
  }

  useEffect(() => {
    if (!me) return;

    const ws = new WebSocket(`${NOTIFICATION_API}/ws`);

    ws.onmessage = (event) => {
      try {
        const data = decodeWsPayload(event.data);
        if (data.type === 'new_message') {
          const msg: Message = data.payload;
          setMessagesByChat((prev) => ({
            ...prev,
            [msg.chat_id]: [...(prev[msg.chat_id] || []), msg],
          }));
        }
      } catch (e) {
        console.error('WS parse error', e);
      }
    };

    return () => ws.close();
  }, [me]);

  async function openChat(chatId: string) {
    setCurrentChatId(chatId);

    if (messagesByChat[chatId]) return;

    try {
      const resp = await apiFetch<{ messages: Message[] }>(
        `${CHAT_API}/messages?chat_id=${chatId}`
      );
      setMessagesByChat((prev) => ({ ...prev, [chatId]: resp.messages }));
    } catch (err) {
      console.error('Failed to load messages', err);
    }
  }

  async function sendMessage() {
    if (!currentChatId || !messageText.trim() || !me) return;

    const text = messageText.trim();
    setMessageText('');

    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      sender_id: me.id,
      chat_id: currentChatId,
      text,
      created_at: new Date().toISOString(),
    };

    setMessagesByChat((prev) => ({
      ...prev,
      [currentChatId]: [...(prev[currentChatId] || []), optimistic],
    }));

    try {
      await apiFetch(`${CHAT_API}/messages`, {
        method: 'POST',
        body: JSON.stringify({ chat_id: currentChatId, text }),
      });
    } catch (e) {
      console.error('Failed to send message', e);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl bg-slate-900 p-8 shadow-2xl space-y-6">
          <h1 className="text-3xl font-bold text-center">Chatterbox</h1>

          <div className="flex border-b border-slate-700 text-center">
            <button
              onClick={() => setIsLoginMode(true)}
              className={`flex-1 pb-3 ${isLoginMode ? 'border-b-2 border-blue-500 font-semibold' : 'text-slate-400'}`}
            >
              Login
            </button>
            <button
              onClick={() => setIsLoginMode(false)}
              className={`flex-1 pb-3 ${!isLoginMode ? 'border-b-2 border-blue-500 font-semibold' : 'text-slate-400'}`}
            >
              Register
            </button>
          </div>

          <input
            className="w-full rounded-xl bg-slate-800 p-3"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full rounded-xl bg-slate-800 p-3"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {!isLoginMode && (
            <>
              <input
                className="w-full rounded-xl bg-slate-800 p-3"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <input
                className="w-full rounded-xl bg-slate-800 p-3"
                placeholder="Full Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </>
          )}

          <button
            onClick={handleAuth}
            className="w-full rounded-xl bg-blue-600 p-3 font-semibold hover:bg-blue-700 transition"
          >
            {isLoginMode ? 'Login' : 'Register'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-950 text-white flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 border-r border-slate-800 bg-slate-900 flex flex-col">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <h2 className="text-xl font-bold">Chats</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setShowCreateChat(true)}
              className="px-4 py-1.5 bg-blue-600 rounded-xl text-sm hover:bg-blue-700"
            >
              + New Chat
            </button>
            <button onClick={logout} className="text-red-400 text-sm hover:underline px-2">
              Logout
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {chats.length === 0 && (
            <div className="text-center text-slate-500 py-8">No chats yet</div>
          )}
          {chats.map((chat) => {
            const otherIds = chat.participant_ids.filter((id) => id !== me.id);
            let title = chat.display_name;

            if (!title) {
              if (otherIds.length === 1) {
                const other = users[otherIds[0]];
                title = other?.display_name || other?.username || 'Unknown User';
              } else {
                title = `Group Chat (${otherIds.length + 1})`;
              }
            }

            return (
              <button
                key={chat.id}
                onClick={() => openChat(chat.id)}
                className={`w-full text-left rounded-2xl p-3 transition-all ${
                  currentChatId === chat.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 hover:bg-slate-700'
                }`}
              >
                {title}
              </button>
            );
          })}
        </div>
      </aside>

      {/* Chat Area */}
      <main className="flex-1 flex flex-col">
        <div className="border-b border-slate-800 p-4 font-semibold">
          {currentChatId ? 'Conversation' : 'Select a chat or create a new one'}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {currentMessages.map((msg) => {
            const isMine = msg.sender_id === me.id;
            const sender = isMine ? me : users[msg.sender_id];

            return (
              <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[65%] rounded-3xl px-5 py-3 ${
                    isMine ? 'bg-blue-600' : 'bg-slate-800'
                  }`}
                >
                  <div className="text-xs opacity-70 mb-1">
                    {isMine ? 'You' : sender?.display_name || sender?.username || 'Unknown'}
                  </div>
                  <div className="break-words">{msg.text}</div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {currentChatId && (
          <div className="border-t border-slate-800 p-4 bg-slate-900 flex gap-3">
            <input
              className="flex-1 rounded-3xl bg-slate-800 px-5 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Type a message..."
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            />
            <button
              onClick={sendMessage}
              className="rounded-3xl bg-blue-600 px-8 font-semibold hover:bg-blue-700 transition"
            >
              Send
            </button>
          </div>
        )}
      </main>

      {/* Modal: Create Chat */}
      {showCreateChat && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-slate-900 rounded-3xl p-8 w-full max-w-lg">
            <h3 className="text-2xl font-bold mb-6">Create New Chat</h3>

            <div className="mb-6">
              <p className="text-sm text-slate-400 mb-3">Select participants:</p>
              <div className="max-h-64 overflow-y-auto space-y-2 pr-2">
                {Object.values(users)
                  .filter((u) => u.id !== me.id)
                  .map((user) => (
                    <label
                      key={user.id}
                      className="flex items-center gap-3 p-3 bg-slate-800 rounded-2xl cursor-pointer hover:bg-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(user.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedUsers([...selectedUsers, user.id]);
                          } else {
                            setSelectedUsers(selectedUsers.filter((id) => id !== user.id));
                          }
                        }}
                      />
                      <div>
                        <div className="font-medium">{user.display_name}</div>
                        <div className="text-xs text-slate-500">@{user.username}</div>
                      </div>
                    </label>
                  ))}
              </div>
            </div>

            {selectedUsers.length >= 2 && (
              <input
                className="w-full rounded-2xl bg-slate-800 p-3 mb-6"
                placeholder="Group chat name (optional)"
                value={newChatName}
                onChange={(e) => setNewChatName(e.target.value)}
              />
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCreateChat(false);
                  setSelectedUsers([]);
                  setNewChatName('');
                }}
                className="flex-1 py-3 rounded-2xl border border-slate-700 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={createChat}
                disabled={selectedUsers.length === 0}
                className="flex-1 py-3 bg-blue-600 rounded-2xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}