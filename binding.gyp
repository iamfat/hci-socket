{
    "targets": [{
        "target_name": "socket",
        "cflags!": [ "-fno-exceptions" ],
		"cflags_cc!": [ "-fno-exceptions" ],
        "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
        "sources": [ 'src/socket.cpp' ],
        "defines": [ 'NAPI_DISABLE_CPP_EXCEPTIONS' ],
    }],
}
