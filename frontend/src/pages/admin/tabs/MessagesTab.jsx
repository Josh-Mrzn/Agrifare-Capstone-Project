import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Send } from 'lucide-react';
import { fetchConversations, fetchConversationMessages, sendChatMessage } from '../../../services/chatApi';
import { API_ORIGIN, getErrorMessage } from '../../../services/authApi';
import { formatTime, formatDate, initialsOf, wholePeso, number } from '../../../utils/format';

/**
 * The signed-in seller's numeric id.
 *
 * `/auth/login` returns it as `id` while `/user/me` returns it as `userId`,
 * and the session holds whichever the login stored. Reading only one of the
 * two is how this screen once showed the seller as their own chat partner.
 */
function myNumericId(user) {
  const n = Number(user?.userId ?? user?.id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** What a conversation row shows when the message is not words. */
function previewOf(message) {
  if (!message) return 'No messages yet';
  if (message.text) return message.text;
  if (message.kind === 'product') return `Shared ${message.product?.name || 'a product'}`;
  if (message.mediaUrl) return 'Sent a photo';
  return 'No messages yet';
}

/** Today shows the time; anything older shows the date. */
function when(value) {
  if (!value) return '';
  const d = new Date(value);
  return d.toDateString() === new Date().toDateString() ? formatTime(d) : formatDate(d);
}

export default function MessagesTab({ user }) {
  const [conversations, setConversations] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const me = myNumericId(user);

  const loadConversations = async () => {
    try {
      const res = await fetchConversations();
      setConversations(Array.isArray(res.data) ? res.data : []);
    } catch {
      setConversations((prev) => prev || []);
    }
  };

  // Polled rather than pushed: a new message shows within a few seconds.
  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 8000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedId) return undefined;
    const load = () => fetchConversationMessages(selectedId)
      .then((res) => setMessages(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [selectedId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  /** The person on the other end. Never falls back to the seller themselves. */
  const otherOf = (convo) => (me ? convo.participants.find((p) => p.userId !== me) || null : null);

  const selected = conversations?.find((c) => c._id === selectedId);
  const other = selected ? otherOf(selected) : null;

  async function send(e) {
    e.preventDefault();
    if (!draft.trim() || !other) return;
    setSending(true);
    setError('');
    try {
      await sendChatMessage(other.userId, draft.trim());
      setDraft('');
      const res = await fetchConversationMessages(selectedId);
      setMessages(Array.isArray(res.data) ? res.data : []);
      loadConversations();
    } catch (err) {
      setError(getErrorMessage(err, 'Your message was not sent. Try again.'));
    } finally {
      setSending(false);
    }
  }

  if (conversations === null) {
    return <div className="panel"><div className="skeleton-rows"><div className="skeleton" /><div className="skeleton" /></div></div>;
  }

  return (
    <section className={`panel chat${selected ? ' has-thread' : ''}`}>
      <div className="chat-list">
        <div className="panel-head"><h2>Conversations</h2></div>
        {conversations.length === 0 ? (
          <div className="empty">
            <strong>No messages yet</strong>
            <p>Buyers can message you from your shop in the app. Every order also starts a conversation.</p>
          </div>
        ) : (
          <ul className="list">
            {conversations.map((c) => {
              const person = otherOf(c);
              if (!person) {
                return <li key={c._id} className="list-row muted">Sign out and back in to load this conversation.</li>;
              }
              return (
                <li key={c._id}>
                  <button
                    type="button"
                    className="list-row chat-row"
                    aria-current={c._id === selectedId ? 'true' : undefined}
                    onClick={() => setSelectedId(c._id)}
                  >
                    <span className="avatar">{initialsOf(person.name)}</span>
                    <span className="list-row-main">
                      <strong>{person.name}</strong>
                      <span className="chat-preview">{previewOf(c.lastMessage)}</span>
                    </span>
                    <span className="list-row-side chat-meta">
                      <span className="muted">{when(c.lastMessage?.createdAt)}</span>
                      {c.unreadCount > 0 && <span className="chat-unread">{c.unreadCount}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="chat-thread">
        {!selected ? (
          <div className="empty chat-placeholder"><p>Choose a conversation.</p></div>
        ) : (
          <>
            <div className="panel-head chat-head">
              <button type="button" className="btn btn-ghost btn-icon btn-sm chat-back" aria-label="Back to conversations" onClick={() => setSelectedId(null)}>
                <ArrowLeft size={18} aria-hidden="true" />
              </button>
              <span className="avatar">{initialsOf(other?.name)}</span>
              <div className="cell-main">
                <strong>{other?.name}</strong>
                <span>{other?.role === 'buyer' ? 'Buyer' : other?.role}</span>
              </div>
            </div>

            <div className="chat-messages" aria-live="polite">
              {messages.map((m) => {
                // An order update is nobody's turn, so it sits across the thread.
                if (m.kind === 'system') {
                  return <p key={m._id} className="msg-system">{m.text}</p>;
                }
                const mine = m.sender?.userId === me;
                return (
                  <div key={m._id} className={`msg${mine ? ' is-mine' : ''}`}>
                    <div className="msg-bubble">
                      {m.product && (
                        <span className="msg-product">
                          <strong>{m.product.name}</strong>
                          <span>
                            {wholePeso(m.product.price)} per kg,{' '}
                            {m.product.stock > 0 ? `${number(m.product.stock)} kg left` : 'sold out'}
                          </span>
                        </span>
                      )}
                      {m.mediaUrl && (
                        <a href={`${API_ORIGIN}${m.mediaUrl}`} target="_blank" rel="noreferrer" className="msg-photo">
                          <img src={`${API_ORIGIN}${m.mediaUrl}`} alt="Photo sent in chat" loading="lazy" />
                        </a>
                      )}
                      {m.text}
                    </div>
                    <span className="msg-time">{when(m.createdAt)}</span>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            <form className="chat-compose" onSubmit={send}>
              <label className="sr-only" htmlFor="chat-draft">Message</label>
              <input
                id="chat-draft"
                className="input"
                placeholder="Write a message…"
                autoComplete="off"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button className="btn btn-primary" type="submit" disabled={!draft.trim() || sending}>
                <Send size={16} aria-hidden="true" /> Send
              </button>
            </form>
            {error && <p className="alert alert-danger chat-error">{error}</p>}
          </>
        )}
      </div>
    </section>
  );
}
