import {mountHexLife} from './hexlife.ts'

const mount = document.getElementById('world') as HTMLElement
const status = document.getElementById('status') as HTMLElement

mountHexLife(mount, status)
