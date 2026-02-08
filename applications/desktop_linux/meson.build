project('jarvis-desktop', 'c', 'cpp',
  version : '1.0.0',
  default_options : ['warning_level=3'])

gtk4_dep = dependency('gtk4', version: '>= 4.0')
json_dep = dependency('json-c', version: '>= 0.13')
curl_dep = dependency('libcurl', version: '>= 7.0')

executable('jarvis-desktop',
  'src/main.c',
  'src/api_client.c',
  'src/ui_main.c',
  dependencies : [gtk4_dep, json_dep, curl_dep],
  install : true)
