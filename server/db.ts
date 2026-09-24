import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CommentThread, Device } from '../shared/types.ts';
import { DATA_FILE } from './config.ts';

export interface Project {
  id: string;
  name: string;
  url: string;
  targetOrigin: string;
  startPath: string;
  device: Device;
  shareToken: string;
  shareEnabled: boolean;
  allowComments: boolean;
  lockDevice?: boolean;
  createdAt: string;
  updatedAt: string;
  nextNumber: number;
}

export interface StoredReply {
  id: string;
  author: string;
  authorId: string;
  secretHash: string;
  role: CommentThread['role'];
  text: string;
  createdAt: string;
}

export interface StoredComment extends Omit<CommentThread, 'replies'> {
  projectId: string;
  secretHash: string;
  replies: StoredReply[];
}

interface Data {
  projects: Project[];
  comments: StoredComment[];
}

function load(): Data {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { projects: d.projects ?? [], comments: d.comments ?? [] };
  } catch {
    return { projects: [], comments: [] };
  }
}

const data = load();
let saveTimer: NodeJS.Timeout | null = null;

function flush() {
  saveTimer = null;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

export const db = {
  data,
  save() {
    if (!saveTimer) saveTimer = setTimeout(flush, 30);
  },
};

export const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
export const hashSecret = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
