import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('officer', {})
