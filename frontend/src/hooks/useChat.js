import { useState, useCallback, useRef } from 'react'
import * as api from '../api'

export function useChat() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hi! Ask me anything about our cookbook — what to make tonight, substitutions, techniques, or any recipe questions. Flip a card and hit **Cook Now** to get focused help with a specific recipe.' }
  ])
  const [sending, setSending] = useState(false)
  const recipeContextRef = useRef(null)

  const setRecipeContext = useCallback((ctx) => {
    recipeContextRef.current = ctx
  }, [])

  const clearRecipeContext = useCallback(() => {
    recipeContextRef.current = null
  }, [])

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || sending) return

    const userMsg = { role: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setSending(true)

    try {
      // Build history for API (last 8 messages)
      const history = [...messages, userMsg]
        .slice(-8)
        .map(m => ({ role: m.role, content: m.content }))

      const payload = {
        message: text.trim(),
        history,
      }
      if (recipeContextRef.current) {
        payload.recipeContext = recipeContextRef.current
      }

      const data = await api.sendChatMessage(payload)
      const reply = data.reply || data.response || 'Sorry, I could not generate a response.'
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
    } finally {
      setSending(false)
    }
  }, [messages, sending])

  const clearHistory = useCallback(() => {
    setMessages([messages[0]])
  }, [messages])

  return {
    messages,
    sending,
    sendMessage,
    setRecipeContext,
    clearRecipeContext,
    recipeContext: recipeContextRef.current,
    clearHistory,
  }
}
