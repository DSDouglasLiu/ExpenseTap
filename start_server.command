#!/bin/bash
cd "$(dirname "$0")"
echo "Starting ExpenseTap Local Server..."
echo "Please open http://localhost:8000 in your browser"
python3 -m http.server 8000
