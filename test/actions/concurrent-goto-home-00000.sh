# repeat 5

for i in {1..100}; do
  goto --url "http://localhost:8080/" --tab "$i" &
done

wait

for i in {1..100}; do
  echo "Checking tab $i"
  printf "$i" >./var/netero/active-tab.txt
  assert_response_code_equal 200
  assert_query_returns_equal "//p" "User: alice, Device: iphone"
done
