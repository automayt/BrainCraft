/**
 * The server's API described for people and tools: `GET /api/openapi.json` (OpenAPI 3.1, for
 * client generators, API tools and AI agents) and `GET /api/docs` (the same, as a page to read).
 * Both describe this server as it runs: with accounts, boards are reached by signing in or an API
 * token; without, by each board's edit or view key.
 */

import { OPS } from '../src/api/ops'
import { OP_SCHEMAS, opSchema } from '../src/api/opSchemas'
import { KIND_LABELS } from '../src/model/types'

export interface SpecOptions {
  version: string
  accounts: boolean
  /** Which AI routes are switched on. */
  ai: { anthropic: boolean; openai: boolean; command: boolean }
}

type Schema = Record<string, unknown>

interface Operation {
  tags: string[]
  summary: string
  description?: string
  operationId: string
  parameters?: Schema[]
  requestBody?: Schema
  responses: Record<string, Schema>
  security?: Record<string, string[]>[]
}

const json = (schema: Schema, example?: unknown) => ({ content: { 'application/json': { schema, ...(example !== undefined ? { example } : {}) } } })
const ok = (description: string, schema: Schema = { type: 'object' }, example?: unknown) => ({ description, ...json(schema, example) })
const error = (description: string) => ({ description, ...json({ $ref: '#/components/schemas/Error' }) })
const path = (name: string, description: string, schema: Schema = { type: 'string' }) => ({ name, in: 'path', required: true, description, schema })
const query = (name: string, description: string, schema: Schema = { type: 'string' }, required = false) => ({ name, in: 'query', required, description, schema })

const boardId = path('id', 'The board’s id')

export function openApiSpec(o: SpecOptions) {
  const boardAuth: Record<string, string[]>[] = o.accounts ? [{ session: [] }, { apiToken: [] }] : [{ boardKey: [] }, { boardKeyQuery: [] }]
  const denied: Record<string, Schema> = o.accounts
    ? { '401': error('Not signed in'), '404': error('No such board, or you don’t have access to it') }
    : { '403': error('Missing or wrong key'), '404': error('No such board') }
  const paths: Record<string, Record<string, Operation>> = {}
  const add = (p: string, method: string, op: Operation) => ((paths[p] ??= {})[method] = op)

  add('/api/health', 'get', {
    tags: ['Server'],
    summary: 'What this server offers',
    operationId: 'health',
    security: [],
    responses: { '200': ok('Its name, version and what is switched on', { $ref: '#/components/schemas/Health' }) },
  })
  add('/api/openapi.json', 'get', { tags: ['Server'], summary: 'This description, as OpenAPI 3.1', operationId: 'openapi', security: [], responses: { '200': ok('The OpenAPI document') } })

  // ----- boards ---------------------------------------------------------------------------------
  if (o.accounts)
    add('/api/boards', 'get', {
      tags: ['Boards'],
      summary: 'The boards you can open',
      operationId: 'listBoards',
      security: boardAuth,
      responses: { '200': ok('Newest first', { type: 'object', properties: { boards: { type: 'array', items: { $ref: '#/components/schemas/BoardEntry' } } } }), '401': error('Not signed in') },
    })
  add('/api/boards', 'post', {
    tags: ['Boards'],
    summary: o.accounts ? 'Make a board (it’s yours; needs “Make boards”)' : 'Make a shared board',
    description: o.accounts ? undefined : 'Answers with the board’s id and its two keys: the edit key changes it, the view key only reads it. Anyone who can reach the server may call this.',
    operationId: 'createBoard',
    security: o.accounts ? boardAuth : [],
    requestBody: { required: false, ...json({ type: 'object', properties: { board: { $ref: '#/components/schemas/Board' } } }) },
    responses: {
      '201': o.accounts
        ? ok('Made', { type: 'object', properties: { id: { type: 'string' }, level: { const: 'manage' } } })
        : ok('Made', { type: 'object', properties: { id: { type: 'string' }, editKey: { type: 'string' }, viewKey: { type: 'string' } } }),
      '400': error('Not a BrainCraft board'),
      ...(o.accounts ? { '403': error('You can’t make boards on this server') } : { '429': error('Too many new boards from this address') }),
    },
  })
  add('/api/boards/{id}', 'get', {
    tags: ['Boards'],
    summary: 'The whole board',
    operationId: 'getBoard',
    parameters: [boardId],
    security: boardAuth,
    responses: { '200': ok('The board as stored (the .braincraft file format)', { type: 'object', properties: { id: { type: 'string' }, role: { enum: ['edit', 'view'] }, version: { type: 'integer' }, board: { $ref: '#/components/schemas/Board' }, people: { type: 'integer', description: 'How many are in its live session' } } }), ...denied },
  })
  add('/api/boards/{id}/ops', 'post', {
    tags: ['Boards'],
    summary: 'Change the board with operations',
    description: 'The batch is applied all or nothing, as one step; everyone in the live session sees it at once. See the Operations section for each operation’s fields.',
    operationId: 'applyOps',
    parameters: [boardId],
    security: boardAuth,
    requestBody: {
      required: true,
      ...json(
        { type: 'object', properties: { ops: { type: 'array', items: { $ref: '#/components/schemas/Op' } } }, required: ['ops'] },
        { ops: [{ op: 'createNote', ref: 'idea', text: 'Launch party?' }, { op: 'addComment', id: 'idea', text: 'Friday works for me' }] },
      ),
    },
    responses: {
      '200': ok('Applied', { type: 'object', properties: { version: { type: 'integer' }, results: { type: 'array', items: { $ref: '#/components/schemas/OpResult' } } } }),
      '400': error('No operations in the body'),
      '422': error('An operation is invalid; nothing changed. The message names it and the field at fault'),
      ...denied,
      ...(o.accounts ? {} : { '403': error('Missing or wrong key, or a view key') }),
    },
  })
  add('/api/boards/{id}/objects', 'get', {
    tags: ['Reading boards'],
    summary: 'What’s on the board',
    description: 'Title, how many of each kind, every object (id, kind, label, position, size, comment count, status) and the lines between them. For a wiki: its pages.',
    operationId: 'listObjects',
    parameters: [boardId, query('kind', 'Only objects of this kind', { enum: Object.keys(KIND_LABELS) })],
    security: boardAuth,
    responses: { '200': ok('The board described'), '400': error('Unknown kind'), ...denied },
  })
  add('/api/boards/{id}/objects/{objectId}', 'get', {
    tags: ['Reading boards'],
    summary: 'One object in full',
    description: 'Its text, description, comments and data: a table as CSV, Kanban columns and cards, timeline lanes, a mind map’s outline, a database view’s records.',
    operationId: 'getObject',
    parameters: [boardId, path('objectId', 'The object’s id', { type: 'integer' })],
    security: boardAuth,
    responses: { '200': ok('The object'), ...denied },
  })
  add('/api/boards/{id}/search', 'get', {
    tags: ['Reading boards'],
    summary: 'Search the board',
    description: 'Text, comments, descriptions, table cells, cards, timeline entries and line labels; in a wiki, page titles and text.',
    operationId: 'search',
    parameters: [boardId, query('q', 'What to look for', { type: 'string' }, true)],
    security: boardAuth,
    responses: { '200': ok('Matches with a snippet each'), '400': error('No query'), ...denied },
  })
  add('/api/boards/{id}/mermaid', 'get', {
    tags: ['Reading boards'],
    summary: 'Flowcharts as Mermaid',
    operationId: 'exportMermaid',
    parameters: [boardId, query('ids', 'Only these objects, comma-separated ids')],
    security: boardAuth,
    responses: { '200': { description: 'Mermaid flowchart source', content: { 'text/plain': { schema: { type: 'string' }, example: 'flowchart TD\n  n1([Start]) --> n2[Ship it]' } } }, ...denied },
  })
  add('/api/boards/{id}/pages', 'get', {
    tags: ['Wikis'],
    summary: 'A wiki’s pages as a tree',
    description: 'Each page’s id, title, icon, last edit (when and who) and length, with its sub-pages; and the trash.',
    operationId: 'listPages',
    parameters: [boardId],
    security: boardAuth,
    responses: { '200': ok('The page tree'), '409': error('The board is a canvas, not a wiki'), ...denied },
  })
  const pageParam = path('page', 'A page id or its exact title (URL-encoded)')
  add('/api/boards/{id}/pages/{page}', 'get', {
    tags: ['Wikis'],
    summary: 'One page',
    description: 'Where it sits, its Markdown, its sub-pages and the pages linking to it. With ?version=N, that saved version instead.',
    operationId: 'getPage',
    parameters: [boardId, pageParam, query('version', 'A version number from the page’s history', { type: 'integer' })],
    security: boardAuth,
    responses: { '200': ok('The page'), '409': error('The board is a canvas, not a wiki'), ...denied },
  })
  add('/api/boards/{id}/pages/{page}/history', 'get', {
    tags: ['Wikis'],
    summary: 'A page’s saved versions, newest first',
    description: 'Number, when, who, the writer’s note, lines added and removed, renames and milestones.',
    operationId: 'pageHistory',
    parameters: [boardId, pageParam],
    security: boardAuth,
    responses: { '200': ok('The versions'), '409': error('The board is a canvas, not a wiki'), ...denied },
  })
  const notWiki = { '409': error('The board is a canvas, not a wiki') }
  const cantEdit = { '403': error(o.accounts ? 'You can only view it, or the page is protected (only people who manage the wiki may change it)' : 'A view key') }
  add('/api/boards/{id}/pages', 'post', {
    tags: ['Wikis'],
    summary: 'Add a page',
    description: 'The same as the createPage operation: `parent` and `before` take a page id or exact title; its first version carries `note`.',
    operationId: 'createPage',
    parameters: [boardId],
    security: boardAuth,
    requestBody: { required: true, ...json({ type: 'object', properties: { title: { type: 'string' }, parent: { type: 'string' }, before: { type: 'string' }, text: { type: 'string', description: 'Markdown' }, icon: { type: 'string' }, note: { type: 'string' } }, required: ['title'] }, { title: 'Meeting notes', parent: 'Home', text: '## Decisions\n- [ ] Book the hall', note: 'From Tuesday' }) },
    responses: { '201': ok('The new page, as GET returns it'), '422': error('Something in it isn’t right; nothing changed'), ...cantEdit, ...notWiki, ...denied },
  })
  add('/api/boards/{id}/pages/{page}', 'put', {
    tags: ['Wikis'],
    summary: 'Change a page',
    description: '`text` replaces its Markdown and `append` adds to the end; `note` says what changed. Its history keeps a version from before and after. `protected` (true or false) is for people who manage the wiki.',
    operationId: 'updatePage',
    parameters: [boardId, pageParam],
    security: boardAuth,
    requestBody: { required: true, ...json({ type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' }, append: { type: 'string' }, icon: { type: ['string', 'null'] }, note: { type: 'string' }, protected: { type: 'boolean' } } }, { append: '- [ ] Send the invites', note: 'Added a task' }) },
    responses: { '200': ok('The page now'), '404': error('No page with that id or title'), '422': error('Something in it isn’t right; nothing changed'), ...cantEdit, ...notWiki, ...denied },
  })
  add('/api/boards/{id}/pages/{page}', 'delete', {
    tags: ['Wikis'],
    summary: 'Move a page (and its sub-pages) to the trash',
    operationId: 'trashPage',
    parameters: [boardId, pageParam],
    security: boardAuth,
    responses: { '200': ok('Trashed', { type: 'object', properties: { page: { type: 'string' }, trashed: { const: true } } }), ...cantEdit, ...notWiki, ...denied },
  })
  add('/api/boards/{id}/pages/{page}/move', 'post', {
    tags: ['Wikis'],
    summary: 'Move a page with its sub-pages',
    operationId: 'movePage',
    parameters: [boardId, pageParam],
    security: boardAuth,
    requestBody: { required: true, ...json({ type: 'object', properties: { parent: { type: ['string', 'null'], description: 'A page, or null for the top' }, before: { type: 'string' } } }) },
    responses: { '200': ok('The page in its new place'), '422': error('A page can’t go inside its own sub-pages'), ...cantEdit, ...notWiki, ...denied },
  })
  add('/api/boards/{id}/pages/{page}/export', 'get', {
    tags: ['Wikis'],
    summary: 'One page as a file',
    operationId: 'exportPage',
    parameters: [boardId, pageParam, query('format', 'md (default) or html', { enum: ['md', 'html'] })],
    security: boardAuth,
    responses: { '200': { description: 'The file', content: { 'text/markdown': { schema: { type: 'string' } }, 'text/html': { schema: { type: 'string' } } } }, ...notWiki, ...denied },
  })
  add('/api/boards/{id}/export', 'get', {
    tags: ['Boards'],
    summary: 'The whole board as a file',
    description: 'Any board: `json` (a .braincraft file, the default) or `md` (a canvas as an outline; a wiki page after page). A wiki also: `html` (one web page with a contents list, printable) and `zip` (a Markdown file per page). Pictures and PDFs of a canvas come from the app.',
    operationId: 'exportBoard',
    parameters: [boardId, query('format', 'json, md, html (wikis) or zip (wikis)', { enum: ['json', 'md', 'html', 'zip'] })],
    security: boardAuth,
    responses: { '200': { description: 'The file, as an attachment' }, '400': error('A format this board doesn’t come in'), ...denied },
  })
  if (o.accounts) {
    add('/api/boards/{id}/access', 'get', {
      tags: ['Boards'],
      summary: 'Who has the board',
      operationId: 'getAccess',
      parameters: [boardId],
      security: boardAuth,
      responses: { '200': ok('The owner and the access list', { $ref: '#/components/schemas/Access' }), ...denied },
    })
    add('/api/boards/{id}/people', 'get', {
      tags: ['Boards'],
      summary: 'Who can open the board, to @mention',
      description: 'Names and account ids; emails too for people who may “See everyone”.',
      operationId: 'boardPeople',
      parameters: [boardId],
      security: boardAuth,
      responses: { '200': ok('The people', { type: 'object', properties: { people: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' } } } } } }), ...denied },
    })
    add('/api/boards/{id}/access', 'put', {
      tags: ['Boards'],
      summary: 'Change who has the board, or hand it over',
      description: 'Needs “Can manage”. Giving anyone more access needs “Share boards”; handing it over needs the owner or an admin.',
      operationId: 'setAccess',
      parameters: [boardId],
      security: boardAuth,
      requestBody: {
        required: true,
        ...json({ type: 'object', properties: { access: { type: 'array', items: { $ref: '#/components/schemas/Grant' } }, owner: { type: 'string', description: 'A user id' } } }, { access: [{ who: 'group', id: 'g1', level: 'edit' }] }),
      },
      responses: { '200': ok('Who has it now', { $ref: '#/components/schemas/Access' }), '400': error('A grant names no one, or a level that doesn’t exist'), '403': error('Not allowed'), ...denied },
    })
    add('/api/boards/{id}', 'delete', {
      tags: ['Boards'],
      summary: 'Delete the board from the server',
      operationId: 'deleteBoard',
      parameters: [boardId],
      security: boardAuth,
      responses: { '200': ok('Deleted'), '403': error('Needs “Can manage”'), ...denied },
    })
  }

  add('/api/unfurl', 'get', {
    tags: ['Server'],
    summary: 'A web page’s preview, for link cards',
    operationId: 'unfurl',
    parameters: [query('url', 'An http(s) address on the public internet', { type: 'string', format: 'uri' }, true)],
    security: o.accounts ? boardAuth : [],
    responses: {
      '200': ok('The preview', { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, image: { type: 'string' }, site: { type: 'string' } } }),
      '422': error('That page won’t get a preview'),
      '429': error('Too many previews from this address'),
      '503': error('Busy; try again soon'),
    },
  })

  // ----- accounts -------------------------------------------------------------------------------
  if (o.accounts) {
    const me = (summary: string, operationId: string, extra: Partial<Operation> = {}) => ({ tags: ['Accounts'], summary, operationId, security: boardAuth, responses: { '200': ok('Done'), '401': error('Not signed in') }, ...extra })
    add('/api/auth/me', 'get', { tags: ['Accounts'], summary: 'Who’s signed in, what they may do, and how this server signs people in', operationId: 'me', security: [], responses: { '200': ok('The person (or null) and the server’s sign-in') } })
    add('/api/auth/login', 'post', {
      tags: ['Accounts'],
      summary: 'Sign in with an email and password (sets the session cookie)',
      operationId: 'login',
      security: [],
      requestBody: { required: true, ...json({ type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' } }, required: ['email', 'password'] }) },
      responses: { '200': ok('Signed in'), '401': error('The email and password don’t match'), '429': error('Too many tries') },
    })
    add('/api/auth/logout', 'post', me('Sign out', 'logout'))
    add('/api/auth/password', 'post', me('Change your password', 'changePassword', { requestBody: { required: true, ...json({ type: 'object', properties: { current: { type: 'string' }, password: { type: 'string', minLength: 10 } }, required: ['password'] }) } }))
    add('/api/auth/tokens', 'get', me('Your API tokens', 'listTokens'))
    add('/api/auth/tokens', 'post', me('Make an API token (shown once)', 'createToken', { requestBody: { required: false, ...json({ type: 'object', properties: { name: { type: 'string' } } }) }, responses: { '201': ok('The token and your tokens', { type: 'object', properties: { token: { type: 'string', example: 'bct_…' } } }), '401': error('Not signed in') } }))
    add('/api/auth/tokens/{tokenId}', 'delete', me('Revoke an API token', 'revokeToken', { parameters: [path('tokenId', 'The token’s id from the list')] }))
    add('/api/mentions', 'get', me('Where you’re @mentioned: comments, descriptions and wiki pages on the boards you can open, newest first (at most 100)', 'mentions'))
    add('/api/people', 'get', me('People and groups to share with', 'people', { parameters: [query('q', 'Part of a name or email (an exact email without “See everyone”)')] }))
    const admin = (summary: string, operationId: string, extra: Partial<Operation> = {}) => ({ tags: ['Admin'], summary, operationId, security: boardAuth, responses: { '200': ok('Done'), '401': error('Not signed in'), '403': error('Admins only') }, ...extra })
    add('/api/admin/users', 'get', admin('People, groups and permissions', 'adminUsers'))
    add('/api/admin/users', 'post', admin('Add someone (answers with a set-your-password link when no password is given)', 'addUser', { requestBody: { required: true, ...json({ type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' }, role: { enum: ['user', 'admin'] }, groups: { type: 'array', items: { type: 'string' } }, password: { type: 'string' } }, required: ['email'] }) } }))
    add('/api/admin/users/{userId}', 'patch', admin('Change someone: name, role, groups, turned off', 'updateUser', { parameters: [path('userId', 'Their id')], requestBody: { required: true, ...json({ type: 'object', properties: { name: { type: 'string' }, role: { enum: ['user', 'admin'] }, groups: { type: 'array', items: { type: 'string' } }, disabled: { type: 'boolean' } } }) } }))
    add('/api/admin/users/{userId}', 'delete', admin('Remove someone', 'removeUser', { parameters: [path('userId', 'Their id')] }))
    add('/api/admin/users/{userId}/reset', 'post', admin('A new set-your-password link for someone', 'resetLink', { parameters: [path('userId', 'Their id')] }))
    add('/api/admin/groups', 'post', admin('Make a group', 'addGroup', { requestBody: { required: true, ...json({ $ref: '#/components/schemas/GroupInput' }) } }))
    add('/api/admin/groups/{groupId}', 'patch', admin('Change a group: name, permissions, members, provider groups', 'updateGroup', { parameters: [path('groupId', 'Its id')], requestBody: { required: true, ...json({ $ref: '#/components/schemas/GroupInput' }) } }))
    add('/api/admin/groups/{groupId}', 'delete', admin('Remove a group', 'removeGroup', { parameters: [path('groupId', 'Its id')] }))
    add('/api/admin/audit', 'get', admin('The activity log, newest first', 'audit', {
      parameters: [
        query('before', 'Entries before this number (for older ones)', { type: 'integer' }),
        query('limit', 'At most this many (up to 200)', { type: 'integer' }),
        query('kind', 'Only this kind', { enum: ['people', 'signin', 'boards', 'security'] }),
        query('admins', '1: only what admins did'),
        query('q', 'Words to find'),
      ],
    }))
    add('/api/admin/audit/verify', 'get', admin('Check the activity log’s hash chain', 'auditVerify'))
    add('/api/admin/audit/download', 'get', admin('The whole activity log as JSON lines', 'auditDownload'))
  }

  // ----- AI -------------------------------------------------------------------------------------
  const aiAuth: Record<string, string[]>[] = o.accounts ? boardAuth : [{ aiPassword: [] }, {}]
  if (o.ai.anthropic)
    add('/api/ai/v1/messages', 'post', { tags: ['AI'], summary: 'The Anthropic Messages API, through this server’s key', operationId: 'aiMessages', security: aiAuth, requestBody: { required: true, ...json({ type: 'object' }) }, responses: { '200': ok('The model’s answer (streamed when asked)') } })
  if (o.ai.openai)
    add('/api/ai/openai/chat/completions', 'post', { tags: ['AI'], summary: 'Chat completions from this server’s OpenAI-compatible model server', operationId: 'aiChat', security: aiAuth, requestBody: { required: true, ...json({ type: 'object' }) }, responses: { '200': ok('The model’s answer') } })
  if (o.ai.command)
    add('/api/ai/command', 'post', { tags: ['AI'], summary: 'Run one of this server’s command-line agents once (Claude Code, Codex, or its own command)', operationId: 'aiCommand', security: aiAuth, parameters: [query('agent', 'Which agent: an id from /api/health’s aiAgents (default: the first)')], requestBody: { required: true, ...json({ type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] }) }, responses: { '200': ok('Its answer', { type: 'object', properties: { text: { type: 'string' } } }) } })

  return {
    openapi: '3.1.0',
    info: {
      title: 'BrainCraft API',
      version: o.version,
      description: `Read and change BrainCraft boards and wikis from scripts, bots and AI agents. Changes are **operations**: small JSON instructions applied all or nothing, which everyone in a board's live session sees at once.\n\n${
        o.accounts
          ? 'This server has accounts: sign in (a session cookie), or send an API token made in the app (account button → API tokens) as `Authorization: Bearer bct_…`. Requests from a browser that change anything also need the header `X-BrainCraft: 1`.'
          : 'This server shares boards by key: send a board’s edit key (to change it) or view key (to read it) as `Authorization: Bearer <key>`, or as `?key=<key>`.'
      }`,
    },
    tags: [
      { name: 'Boards', description: 'Making boards and changing them with operations' },
      { name: 'Reading boards', description: 'The same answers AI assistants get' },
      { name: 'Wikis', description: 'Pages, their Markdown and their history. Change pages with the createPage, updatePage, movePage and deletePage operations' },
      ...(o.accounts ? [{ name: 'Accounts', description: 'Signing in, your password and API tokens' }, { name: 'Admin', description: 'People, groups and the activity log (admins only)' }] : []),
      { name: 'AI', description: 'The in-app assistant’s routes to its model' },
      { name: 'Server', description: 'About the server' },
    ],
    paths,
    components: {
      securitySchemes: o.accounts
        ? {
            session: { type: 'apiKey', in: 'cookie', name: 'braincraft_session', description: 'Set by signing in; browser requests that change anything also send X-BrainCraft: 1' },
            apiToken: { type: 'http', scheme: 'bearer', description: 'An API token (bct_…) made in the app' },
          }
        : {
            boardKey: { type: 'http', scheme: 'bearer', description: 'The board’s edit or view key' },
            boardKeyQuery: { type: 'apiKey', in: 'query', name: 'key', description: 'The same key, in the address' },
            aiPassword: { type: 'apiKey', in: 'header', name: 'X-BrainCraft-AI-Password', description: 'The AI password, when the server sets one (BRAINCRAFT_AI_PASSWORD)' },
          },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
        Health: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, name: { const: 'braincraft' }, version: { type: 'string' }, ai: { type: 'boolean' }, aiProviders: { type: 'array', items: { type: 'string' } }, previews: { type: 'boolean' }, accounts: { type: 'boolean' } },
        },
        Board: { type: 'object', description: 'A board as stored: the .braincraft file format', properties: { version: { type: 'integer' }, title: { type: 'string' }, kind: { enum: ['wiki'] }, items: { type: 'array' }, connectors: { type: 'array' } } },
        BoardEntry: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, kind: { enum: ['wiki'] }, updated: { type: 'integer' }, level: { enum: ['view', 'edit', 'manage'] }, owner: { type: ['object', 'null'] } } },
        Grant: { type: 'object', properties: { who: { enum: ['user', 'group'] }, id: { type: 'string' }, level: { enum: ['view', 'edit', 'manage'] } }, required: ['who', 'id', 'level'] },
        Access: { type: 'object', properties: { level: { enum: ['view', 'edit', 'manage'] }, owner: { type: ['object', 'null'] }, access: { type: 'array', items: { $ref: '#/components/schemas/Grant' } } } },
        GroupInput: {
          type: 'object',
          properties: { name: { type: 'string' }, description: { type: 'string' }, permissions: { type: 'array', items: { enum: ['boards.create', 'boards.share', 'ai.use', 'people.see'] } }, members: { type: 'array', items: { type: 'string' } }, ssoGroups: { type: 'array', items: { type: 'string' } } },
        },
        OpResult: { type: 'object', properties: { op: { type: 'string' }, id: { type: 'integer' }, ids: { type: 'array', items: { type: 'integer' } }, ref: { type: 'string' }, page: { type: 'string' } } },
        Op: { oneOf: OPS.map((name) => ({ $ref: `#/components/schemas/op.${name}` })), discriminator: { propertyName: 'op' } },
        ...Object.fromEntries(OPS.map((name) => [`op.${name}`, opSchema(name)])),
      },
    },
  }
}

// ----- the page to read ----------------------------------------------------------------------------

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
/** `code` and **bold** in descriptions, nothing more. */
const inline = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

function typeOf(s: Schema | undefined): string {
  if (!s) return ''
  if (s.$ref) return String(s.$ref).split('/').pop()!.replace(/^op\./, '')
  if (s.const !== undefined) return JSON.stringify(s.const)
  if (s.enum) return (s.enum as unknown[]).map((v) => JSON.stringify(v)).join(' | ')
  if (s.oneOf) return (s.oneOf as Schema[]).map(typeOf).join(' or ')
  if (s.type === 'array') return `${typeOf(s.items as Schema)}[]`
  return Array.isArray(s.type) ? s.type.join(' | ') : String(s.type ?? 'any')
}

/** The OpenAPI document as one page: every route, then every operation. */
export function docsPage(spec: ReturnType<typeof openApiSpec>): string {
  const routes: string[] = []
  for (const tag of spec.tags) {
    const ops = Object.entries(spec.paths).flatMap(([p, methods]) => Object.entries(methods).filter(([, op]) => op.tags.includes(tag.name)).map(([m, op]) => ({ p, m, op })))
    if (!ops.length) continue
    routes.push(`<h2 id="${esc(tag.name.toLowerCase().replace(/\s+/g, '-'))}">${esc(tag.name)}</h2><p class="muted">${inline(tag.description)}</p>`)
    for (const { p, m, op } of ops) {
      const params = (op.parameters ?? []).map((x) => `<tr><td><code>${esc(x.name)}</code></td><td>${esc(x.in)}${x.required ? ', required' : ''}</td><td>${esc(typeOf(x.schema as Schema))}</td><td>${inline(String(x.description ?? ''))}</td></tr>`).join('')
      const body = op.requestBody as { content?: Record<string, { schema?: Schema; example?: unknown }> } | undefined
      const bodyJson = body?.content?.['application/json']
      const responses = Object.entries(op.responses).map(([code, r]) => `<li><code>${esc(code)}</code> ${inline(String(r.description ?? ''))}</li>`).join('')
      routes.push(`<section class="route" id="${esc(op.operationId)}">
<h3><span class="method ${esc(m)}">${esc(m.toUpperCase())}</span> <code>${esc(p)}</code></h3>
<p>${inline(op.summary)}</p>${op.description ? `<p class="muted">${inline(op.description)}</p>` : ''}
${params ? `<table><thead><tr><th>Parameter</th><th>In</th><th>Type</th><th></th></tr></thead><tbody>${params}</tbody></table>` : ''}
${bodyJson ? `<p class="label">Body: ${esc(typeOf(bodyJson.schema))}</p>${bodyJson.example !== undefined ? `<pre>${esc(JSON.stringify(bodyJson.example, null, 2))}</pre>` : ''}` : ''}
<ul class="responses">${responses}</ul>
</section>`)
    }
  }
  const ops = OPS.map((name) => {
    const s = OP_SCHEMAS[name]
    const required = new Set(s.required ?? [])
    const rows = Object.entries(s.properties)
      .map(([k, v]) => `<tr><td><code>${esc(k)}</code>${required.has(k) ? '' : '<span class="muted">?</span>'}</td><td>${esc(typeOf(v))}</td><td>${inline(String(v.description ?? ''))}</td></tr>`)
      .join('')
    return `<section class="route" id="op-${esc(name)}"><h3><code>${esc(name)}</code></h3><p>${inline(s.summary)}</p><table><tbody>${rows}</tbody></table></section>`
  }).join('')
  const nav = spec.tags
    .filter((t) => Object.values(spec.paths).some((ms) => Object.values(ms).some((op) => op.tags.includes(t.name))))
    .map((t) => `<a href="#${esc(t.name.toLowerCase().replace(/\s+/g, '-'))}">${esc(t.name)}</a>`)
    .join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>BrainCraft API</title>
<style>
:root{--bg:#fff;--fg:#1d2030;--muted:#5d6475;--line:#e3e5ec;--code:#f3f4f8;--accent:#5b5bd6}
@media (prefers-color-scheme:dark){:root{--bg:#14161d;--fg:#e8eaf2;--muted:#9ba2b4;--line:#2a2e3a;--code:#1d2029;--accent:#8b8bff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:900px;margin:0 auto;padding:24px 16px 80px}nav{display:flex;flex-wrap:wrap;gap:6px 14px;padding:10px 0;border-bottom:1px solid var(--line);margin-bottom:8px}
a{color:var(--accent)}h1{margin:0 0 6px}h2{margin-top:40px;border-bottom:1px solid var(--line);padding-bottom:6px}h3{margin:0 0 4px;font-size:16px;overflow-wrap:anywhere}
.muted{color:var(--muted)}.route{padding:14px 0;border-bottom:1px solid var(--line)}code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:.92em}
pre{background:var(--code);padding:10px;border-radius:6px;overflow:auto;font-size:13px}table{border-collapse:collapse;width:100%;margin:6px 0;font-size:14px;display:block;overflow-x:auto}
td,th{text-align:left;padding:4px 10px 4px 0;vertical-align:top;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:600}
.method{display:inline-block;min-width:58px;text-align:center;font-size:12px;font-weight:700;padding:2px 6px;border-radius:4px;color:#fff;background:#5d6475}
.method.get{background:#2e7d4f}.method.post{background:#3b5bdb}.method.put,.method.patch{background:#b8590c}.method.delete{background:#c92a2a}
.responses{margin:6px 0 0;padding-left:18px;font-size:14px}.label{margin:8px 0 2px;font-weight:600;font-size:14px}
</style></head><body><main>
<h1>BrainCraft API <small class="muted">${esc(spec.info.version)}</small></h1>
<p>${inline(spec.info.description)}</p>
<p>Machine-readable: <a href="openapi.json">/api/openapi.json</a> (OpenAPI 3.1, for client generators and API tools). The same operations also work pasted into the app, from <code>window.BrainCraft.apply()</code> and through the MCP server.</p>
<nav>${nav}<a href="#operations">Operations</a></nav>
${routes.join('\n')}
<h2 id="operations">Operations</h2>
<p class="muted">Send a list of these to <code>POST /api/boards/{id}/ops</code> as <code>{"ops": [...]}</code>. Any create operation takes <code>ref</code> (a name later operations in the batch can use in place of an id) and <code>at</code> (its top-left corner; leave it out and BrainCraft finds room). Dates are YYYY-MM-DD. A field marked <span class="muted">?</span> is optional.</p>
${ops}
</main></body></html>`
}
