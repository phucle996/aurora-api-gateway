import React, { useState } from 'react';
import { Bell, Mail, Check, Send } from 'lucide-react';

export function NotificationsSettingsSection() {
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [slackNotifs, setSlackNotifs] = useState(false);
  const [webhookNotifs, setWebhookNotifs] = useState(false);
  const [smtpServer, setSmtpServer] = useState('smtp.example.com');
  const [smtpPort, setSmtpPort] = useState('587');
  const [senderEmail, setSenderEmail] = useState('waf@example.com');
  const [sendingTest, setSendingTest] = useState(false);
  const [testSentSuccess, setTestSentSuccess] = useState(false);

  const handleSendTestEmail = () => {
    setSendingTest(true);
    setTimeout(() => {
      setSendingTest(false);
      setTestSentSuccess(true);
      setTimeout(() => setTestSentSuccess(false), 3000);
    }, 600);
  };

  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-2 pb-3 border-b border-[#152030] text-sm font-semibold text-white font-mono">
          <Bell className="w-4 h-4 text-emerald-400" />
          <span>Notifications</span>
        </div>

        <div className="mt-3 space-y-3 text-xs font-mono">
          {/* Email Notifications */}
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Email Notifications</span>
            <button
              type="button"
              onClick={() => setEmailNotifs(!emailNotifs)}
              className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${
                emailNotifs ? 'bg-emerald-600' : 'bg-[#152030]'
              }`}
            >
              <div
                className={`w-4 h-4 bg-white transition-transform ${
                  emailNotifs ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Slack Notifications */}
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Slack Notifications</span>
            <button
              type="button"
              onClick={() => setSlackNotifs(!slackNotifs)}
              className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${
                slackNotifs ? 'bg-emerald-600' : 'bg-[#152030]'
              }`}
            >
              <div
                className={`w-4 h-4 bg-white transition-transform ${
                  slackNotifs ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Webhook Notifications */}
          <div className="flex items-center justify-between pb-2 border-b border-[#152030]/60">
            <span className="text-slate-400">Webhook Notifications</span>
            <button
              type="button"
              onClick={() => setWebhookNotifs(!webhookNotifs)}
              className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${
                webhookNotifs ? 'bg-emerald-600' : 'bg-[#152030]'
              }`}
            >
              <div
                className={`w-4 h-4 bg-white transition-transform ${
                  webhookNotifs ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* SMTP Configuration */}
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">SMTP Server</span>
              <input
                type="text"
                value={smtpServer}
                onChange={(e) => setSmtpServer(e.target.value)}
                className="w-48 bg-[#0E1726] border border-[#1C293D] px-2.5 py-1 text-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">SMTP Port</span>
              <input
                type="text"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                className="w-48 bg-[#0E1726] border border-[#1C293D] px-2.5 py-1 text-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Sender Email</span>
              <input
                type="email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                className="w-48 bg-[#0E1726] border border-[#1C293D] px-2.5 py-1 text-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Send Test Email Button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleSendTestEmail}
              disabled={sendingTest}
              className="w-full flex items-center justify-center gap-2 py-2 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-slate-200 hover:text-white text-xs font-mono transition-colors cursor-pointer"
            >
              {sendingTest ? (
                <span>Sending...</span>
              ) : testSentSuccess ? (
                <span className="text-emerald-400 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> Test Email Sent!
                </span>
              ) : (
                <>
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  <span>Send Test Email</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
