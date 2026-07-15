import {mountHexLife} from './hexlife.ts'

const mount = document.getElementById('world') as HTMLElement
const status = document.getElementById('status') as HTMLElement

// Expanded view: full transport + identity + Explorer deep-link.
void mountHexLife(mount, status, {mode: 'lab'})
