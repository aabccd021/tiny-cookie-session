goto --url "http://localhost:8080/?sleep=100" --tab "1" &

sleep 1
goto --url "http://localhost:8080/?sleep=2500" --tab "2" &

sleep 1
goto --url "http://localhost:8080/" --tab "3" &

sleep 1
goto --url "http://localhost:8080/?sleep=7500" --tab "4" &

sleep 1
goto --url "http://localhost:8080/?sleep=400" --tab "5" &

sleep 1
goto --url "http://localhost:8080/?sleep=1000" --tab "6" &

sleep 1
goto --url "http://localhost:8080/?sleep=2000" --tab "7" &

sleep 1
goto --url "http://localhost:8080/?sleep=300" --tab "8" &

sleep 1
goto --url "http://localhost:8080/?sleep=2300" --tab "9" &

sleep 1
goto --url "http://localhost:8080/?sleep=400" --tab "10" &

wait
