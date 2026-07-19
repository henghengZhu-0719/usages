import { useCallback, useEffect, useRef, useState } from 'react';
import { Empty } from 'antd';
import {
  ArrowUpOutlined,
  ClearOutlined,
  CloseOutlined,
  LoadingOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { streamChat } from './api';
import type { ChatMessage } from './types';

interface ChatProps {
  open: boolean;
  onClose: () => void;
}

function Chat({ open, onClose }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 新内容出现时贴到底部
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // 组件卸载时中断进行中的请求
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || sending) return;

    const history: ChatMessage[] = [...messages, { role: 'user', content: question }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(
        history,
        (delta) => {
          setMessages((prev) => {
            const next = prev.slice();
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + delta };
            return next;
          });
        },
        controller.signal,
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        setMessages((prev) => {
          const next = prev.slice();
          const last = next[next.length - 1];
          next[next.length - 1] = {
            ...last,
            content: last.content || `请求失败：${e instanceof Error ? e.message : e}`,
          };
          return next;
        });
      }
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  }, [input, messages, sending]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
  }, []);

  const clear = useCallback(() => {
    stop();
    setMessages([]);
  }, [stop]);

  return (
    <aside className={`chat-panel${open ? ' is-open' : ''}`} aria-label="AI 助手">
      <div className="chat-header">
        <span className="chat-header__title"><RobotOutlined /> AI 助手</span>
        <span className="chat-header__actions">
          <button className="chat-icon-btn" onClick={clear} title="清空对话" disabled={!messages.length}>
            <ClearOutlined />
          </button>
          <button className="chat-icon-btn" onClick={onClose} title="关闭">
            <CloseOutlined />
          </button>
        </span>
      </div>

      <div className="chat-list" ref={listRef}>
        {messages.length ? (
          messages.map((msg, i) => (
            <div key={i} className={`chat-msg chat-msg--${msg.role}`}>
              <div className="chat-msg__bubble">
                {msg.content || (sending && i === messages.length - 1 ? <LoadingOutlined /> : '')}
              </div>
            </div>
          ))
        ) : (
          <Empty
            className="chat-empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="问点什么吧"
          />
        )}
      </div>

      <div className="chat-input">
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {sending ? (
          <button className="chat-send chat-send--stop" onClick={stop} title="停止">
            ■
          </button>
        ) : (
          <button className="chat-send" onClick={() => void send()} disabled={!input.trim()} title="发送">
            <ArrowUpOutlined />
          </button>
        )}
      </div>
    </aside>
  );
}

export default Chat;
