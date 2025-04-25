cp -r ./var/netero/browser/1/tab/1 ./var/netero/browser/1/tab/2

goto --url "http://localhost:8080/?sleep=5000" &

sleep 1

printf "2" >./var/netero/active-tab.txt
goto --url "http://localhost:8080/?sleep=5000"
assert_response_code_equal 200
assert_query_returns_equal "//p" "User: alice, Device: iphone"
printf "1" >./var/netero/active-tab.txt

wait
assert_response_code_equal 200
assert_query_returns_equal "//p" "User: alice, Device: iphone"
