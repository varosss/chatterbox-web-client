# Chatterbox Client

Frontend клиент для распределённого мессенджера **Chatterbox**.

## Tech Stack

- React + TypeScript
- Vite
- Tailwind CSS
- WebSocket (notifications)
- REST API communication

## Features

- Авторизация (JWT access + refresh token)
- Список чатов пользователя
- Реальное время сообщений (WebSocket)
- Отправка сообщений
- Lazy loading сообщений по чатам
- Кэширование сообщений на клиенте

## Architecture

Frontend общается с 3 сервисами:

- User Service → авторизация и пользователи
- Chat Service → чаты и сообщения
- Notification Service → WebSocket события

## Setup

```bash
npm install
npm run dev
