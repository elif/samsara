execute "npm install ." do
  command "npm install ."
  cwd release_path
  user "deploy"
  group "deploy"
end
