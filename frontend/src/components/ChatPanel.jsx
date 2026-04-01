import { useState, useEffect, useRef, useCallback } from 'react'
import { marked } from 'marked'

export default function ChatPanel({ open, onClose, chatHook, recipeContext }) {
  const { messages, sending, sendMessage, setRecipeContext, clearRecipeContext } = chatHook
  const [input, setInput] = useState('')
  const messagesRef = useRef(null)
  const inputRef = useRef(null)

  // Set recipe context when cook mode is active
  useEffect(() => {
    if (recipeContext?.recipeJson) {
      const rj = recipeContext.recipeJson
      setRecipeContext(`Recipe: ${rj.title}. Ingredients: ${(rj.ingredients || []).map(i => `${i.amount} ${i.name}`).join(', ')}. Steps: ${(rj.steps || []).map((s, i) => `${i + 1}. ${s.detail}`).join(' ')}`)
    } else {
      clearRecipeContext()
    }
  }, [recipeContext, setRecipeContext, clearRecipeContext])

  // Auto-scroll
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages])

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current && window.innerWidth > 600) {
      inputRef.current.focus()
    }
  }, [open])

  const handleSend = useCallback(() => {
    if (!input.trim()) return
    sendMessage(input)
    setInput('')
  }, [input, sendMessage])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  if (!open) return null

  return (
    <div className="chat-panel open" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, maxWidth: '100%', zIndex: 640, background: 'var(--cream)', boxShadow: '-4px 0 24px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
      <div className="chat-panel-header" style={{ background: 'var(--dark)', padding: '0.9rem 1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'Playfair Display, serif', color: 'var(--tan)', fontWeight: 700 }}>📖 Recipe Assistant</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tan)', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
      </div>

      {recipeContext?.recipeJson && (
        <div style={{ padding: '0.5rem 1rem', background: 'var(--red-faint)', borderBottom: '1px solid var(--tan)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Discussing: <strong>{recipeContext.recipeJson.title}</strong></span>
          <button onClick={clearRecipeContext} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '0.9rem' }}>✕</button>
        </div>
      )}

      <div ref={messagesRef} style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            marginBottom: '0.8rem',
            padding: '0.7rem 1rem',
            borderRadius: 10,
            maxWidth: '85%',
            fontSize: '0.88rem',
            lineHeight: 1.6,
            ...(msg.role === 'user' ? {
              marginLeft: 'auto',
              background: 'var(--red)',
              color: 'var(--white)',
              borderBottomRightRadius: 2,
            } : {
              background: 'var(--white)',
              color: 'var(--text)',
              border: '1px solid var(--tan)',
              borderBottomLeftRadius: 2,
            })
          }}>
            {msg.role === 'assistant' ? (
              <div dangerouslySetInnerHTML={{ __html: marked.parse(msg.content || '') }} />
            ) : (
              msg.content
            )}
          </div>
        ))}
        {sending && (
          <div style={{ padding: '0.7rem 1rem', borderRadius: 10, background: 'var(--white)', border: '1px solid var(--tan)', maxWidth: '85%', fontSize: '0.85rem', color: 'var(--muted)', fontStyle: 'italic' }}>
            Thinking…
          </div>
        )}
      </div>

      <div style={{ padding: '0.75rem', borderTop: '1px solid var(--tan)', display: 'flex', gap: '0.5rem' }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about a recipe…"
          maxLength={500}
          rows={1}
          style={{
            flex: 1, border: '1px solid var(--tan-dark)', borderRadius: 8, padding: '0.6rem 0.85rem',
            fontSize: '0.88rem', fontFamily: 'Lato, sans-serif', resize: 'none', outline: 'none',
            maxHeight: 100
          }}
          onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px' }}
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          style={{
            background: 'var(--red)', color: 'var(--white)', border: 'none', borderRadius: 8,
            padding: '0.6rem 1rem', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem',
            opacity: sending || !input.trim() ? 0.5 : 1,
          }}
        >➤</button>
      </div>
    </div>
  )
}
