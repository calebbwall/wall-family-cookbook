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
    <div className={`chat-panel${open ? ' open' : ''}`}>
      <div className="chat-panel-header">
        <span className="chat-panel-title">📖 Recipe Assistant</span>
        <button className="chat-panel-close" onClick={onClose}>✕</button>
      </div>

      {recipeContext?.recipeJson && (
        <div className="chat-recipe-context-bar">
          <span>Discussing: <strong>{recipeContext.recipeJson.title}</strong></span>
          <button onClick={clearRecipeContext}>✕</button>
        </div>
      )}

      <div ref={messagesRef} className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg ${msg.role === 'user' ? 'chat-msg-user' : 'chat-msg-assistant'}`}>
            {msg.role === 'assistant' ? (
              <div dangerouslySetInnerHTML={{ __html: marked.parse(msg.content || '') }} />
            ) : (
              msg.content
            )}
          </div>
        ))}
        {sending && (
          <div className="chat-msg chat-msg-thinking">Thinking…</div>
        )}
      </div>

      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about a recipe…"
          maxLength={500}
          rows={1}
          onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px' }}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={sending || !input.trim()}
        >➤</button>
      </div>
    </div>
  )
}
