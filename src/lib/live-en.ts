import { onLang, uiLang } from "@/lib/locale";

const EXACT: Record<string, string> = {
  "我的挂单": "My listings",
  "先连接钱包，这里显示你的挂单。": "Connect a wallet to see your listings.",
  "你还没有挂单。": "You have no listings.",
  "连上钱包后，这里只放你挂着的，方便撤单。": "After you connect, your listings show here so you can cancel them.",
  "持有的在资产里看。": "Holdings are on the Assets page.",
  "USDT 可用": "USDT available",
  "OKB 可用": "OKB available",
  "BEM 可用": "BEM available",
  "TAPE 可用": "TAPE available",
  "系列": "Collections",
  "代币": "Tokens",
  "发射": "Launch",
  "正在铸造": "Minting",
  "市场": "Market",
  "动态": "Activity",
  "资产": "Assets",
  "白皮书": "Paper",
  "深夜": "Dark",
  "白天": "Light",
  "登录": "Log in",
  "退出": "Log out",
  "全部": "All",
  "芯片": "Chips",
  "艺术": "Art",
  "1天": "1D",
  "7天": "7D",
  "30天": "30D",
  "电路朋克": "Circuit Punk",
  "发射、铸造、市场是三页。点左上角标志去铸造，挂单在市场。": "Launch, mint, and market are separate pages. The mark at the top left opens mint. Listings live in the market.",
  "去铸造": "Mint",
  "去市场": "Market",
  "点开看挂单": "Show listings",
  "收起挂单": "Hide listings",
  "更多挂单": "More listings",
  "创世电路 NFT": "Genesis circuits",
  "在售": "For sale",
  "翻全部": "Browse all",
  "上一页": "Prev",
  "下一页": "Next",
  "官方晶体管": "Official transistors",
  "协议电路 NFT": "Protocol circuits",
  "兑换": "Swap",
  "读取中": "Loading",
  "点此用 USDT 换 BEM": "Swap USDT for BEM",
  "点此用 OKB 换 BEM": "Swap OKB for BEM",
  "流动性小": "Thin liquidity",
  "用 X Layer USDT 换 TAPE": "Swap X Layer USDT for TAPE",
  "热门系列": "Trending",
  "这个分类下没有系列": "Nothing in this category",
  "今日涨幅": "Top movers",
  "过去 24 小时地板价变化最大": "Biggest floor move in 24 hours",
  "地板价": "Floor",
  "筛选": "Filters",
  "分类": "Category",
  "链": "Chain",
  "成交额": "Volume",
  "笔数": "Sales",
  "买入": "Buy",
  "卖出": "Sell",
  "支付": "You pay",
  "收到": "You receive",
  "报价读取中": "Loading quote",
  "成交发给官方池子。取消就等于没换。": "The swap is sent to the official pool. Cancel means no trade.",
  "BEM 跨链": "Bridge BEM",
  "数量（BEM）": "Amount (BEM)",
  "手续费读取中": "Loading fee",
  "跨过去": "Bridge",
  "TapeOut 官方 1:1 桥。OKB 和 TAPE 没有这条桥，不会假装跨过去。": "Official TapeOut 1:1 bridge. OKB and TAPE have no bridge here, and none is invented.",
  "链上成交": "On-chain trades",
  "晶体管": "Transistor",
  "最新价 BNB": "Last BNB",
  "最高买价 BNB": "Best bid BNB",
  "买量": "Bid size",
  "24小时量 BNB": "24h volume BNB",
  "正在读取 tapeout.net…": "Reading tapeout.net…",
  "只铸造。挂单和成交在市场页。公开价 1 TAPE + 0.001 BEM。": "Mint only. Listings and sales are on the market page. Public price is 1 TAPE + 0.001 BEM.",
  "持有": "Held",
  "铸造": "Mint",
  "正在读取合约。": "Reading the contract.",
  "数量，最多 10": "Quantity, up to 10",
  "连上钱包后，上面显示 TAPE、BEM 和已铸到的张数。铸完会刷新。": "After you connect, TAPE, BEM, and minted count show above. They refresh after a mint.",
  "去市场交易": "Go to market",
  "另开发射": "Launch another",
  "我铸到的": "Minted by me",
  "市场交易": "Market",
  "挂单可以按 BEM 标价，也可以按 TAPE 标价。成交按 1 BEM 对 1000 TAPE，两边一起付。手续费 0.2%。": "List in BEM or in TAPE. A sale pays both, at 1 BEM to 1000 TAPE. Fee 0.2%.",
  "挂出你的一张": "List one of yours",
  "编号": "Token ID",
  "用哪种标价": "Quote unit",
  "价格（BEM）": "Price (BEM)",
  "价格（TAPE）": "Price (TAPE)",
  "买家付 0.002 BEM，同时付 2 TAPE。": "The buyer pays 0.002 BEM and also 2 TAPE.",
  "按 TAPE 标价。买家同时付对应的 BEM，1 BEM = 1000 TAPE。": "Quoted in TAPE. The buyer also pays the matching BEM. 1 BEM = 1000 TAPE.",
  "按 BEM 标价。买家同时付 1000 倍 TAPE。": "Quoted in BEM. The buyer also pays 1000 times that in TAPE.",
  "现在按 TAPE 标价。买家同时付对应的 BEM。": "Now quoted in TAPE. The buyer also pays the matching BEM.",
  "现在按 BEM 标价。买家同时付 1000 倍的 TAPE。": "Now quoted in BEM. The buyer also pays 1000 times that in TAPE.",
  "连接钱包后，点下面的编号就能挂。": "Connect a wallet, then tap an ID below to fill the form.",
  "挂出": "List",
  "成交在这份合约里。先连钱包。": "Sales settle in this contract. Connect a wallet first.",
  "物品": "Items",
  "挂单": "Listings",
  "正在看物品。没选属性时按稀有度排。": "Browsing items. With no trait selected, rarest come first.",
  "打开": "Open",
  "稀有在前": "Rarest first",
  "稀有在后": "Rarest last",
  "按编号": "By ID",
  "持有地址": "Holders",
  "正在按编号核对每个地址。": "Checking each holder by token ID.",
  "标注": "Label",
  "地址": "Address",
  "张数": "Count",
  "交易记录": "Trades",
  "正在读链上的铸造、挂单和成交。": "Reading mints, listings, and sales from the chain.",
  "正在读链上的真实挂单和成交。": "Reading real listings and sales from the chain.",
  "这段还没有挂单或成交。": "No listings or sales in this range yet.",
  "电路朋克已上链": "Circuit Punk is on-chain",
  "不用再创建。铸造在「正在铸造」，买卖在「市场」。这里只留给以后另开的项目。": "Do not create it again. Mint is under Minting, trading is under Market. This page is only for a future project.",
  "TAPE 对": "TAPE pair",
  "也可": "Or",
  "OKB 或 BEM": "OKB or BEM",
  "单人上限": "Per wallet",
  "10 次": "10 mints",
  "去铸造电路朋克": "Mint Circuit Punk",
  "另开一个项目": "Start another project",
  "电路朋克已经在 X Layer，合约 0xB5ac1dddc158a639D4499aad2d8F393989D4bD34。不要用这个名字再创建一次。": "Circuit Punk is already on X Layer at 0xB5ac1dddc158a639D4499aad2d8F393989D4bD34. Do not create that name again.",
  "名称": "Name",
  "符号": "Symbol",
  "总量": "Supply",
  "预留": "Reserve",
  "发射代币": "Launch token",
  "只用 OKB": "OKB only",
  "只用 BEM": "BEM only",
  "铸造倍数": "Mint multiple",
  "公开铸造价 1 TAPE + 0.001 BEM": "Public mint price 1 TAPE + 0.001 BEM",
  "二级市场只用这次发射的代币。TAPE + BEM 两边一起付，不能只改一边。": "Secondary sales use only the launch token. TAPE + BEM are paid together. One side cannot be changed alone.",
  "批量生成属性": "Generate traits",
  "电路朋克一万张按种类比例生成。每种晶粒的属性和权重都不一样。": "All 10,000 Circuit Punks follow the type mix. Each die has its own traits and weights.",
  "上传图片": "Upload art",
  "自己的 Key": "Your own key",
  "平台默认": "Platform default",
  "朋克": "Punk",
  "真实": "Photo",
  "生成这 4 张": "Generate these 4",
  "上传的图按顺序套到预览上。平台默认和自己的 Key 都是真出图，每次最多 4 张。": "Uploads are applied to the preview in order. Platform default and your own key both really generate images, 4 at a time.",
  "铸造规则": "Mint rules",
  "创建": "Create",
  "电路朋克不用再创建。这里只签一个新项目，私钥不会经过这个页面。": "Circuit Punk does not need to be created again. This only signs a new project. The key never touches this page.",
  "工厂": "Factory",
  "X Layer 上这份地址已写死。没有管理员，不能升级，也不能把金库转走。页面不再另签一份工厂。": "This X Layer address is fixed. There is no admin, no upgrade, and no way to pull the vault. This page will not deploy another factory.",
  "正在读取 tapeout.net 的成交…": "Reading tapeout.net sales…",
  "换背景": "Change background",
  "换头像": "Change avatar",
  "改名字": "Rename",
  "未连接钱包": "Wallet not connected",
  "连接钱包": "Connect wallet",
  "去掉头像": "Remove avatar",
  "去掉背景": "Remove background",
  "余额": "Balance",
  "晶体管持仓": "Transistor holdings",
  "我的电路朋克": "My Circuit Punks",
  "连接钱包后，这里显示张数、编号和图片。": "Connect a wallet to see the count, IDs, and images.",
  "链上资产": "On-chain assets",
  "余额来自这个钱包地址在 BSC 和 X Layer 上的链上数据，不是欧易交易所账户。": "Balances are this address on BSC and X Layer, not an OKX exchange account.",
  "买下": "Buy",
  "撤单": "Cancel listing",
  "关闭": "Close",
  "数量": "Amount",
  "买单价格（BNB）": "Bid (BNB)",
  "用 BNB 挂买单": "Place a BNB bid",
  "卖给当前最高买价": "Sell into the best bid",
  "在 tapeout.net 打开这颗": "Open this one on tapeout.net",
  "创世电路": "Genesis circuit",
  "挂单价格（BNB）": "List price (BNB)",
  "用钱包买下": "Buy with wallet",
  "挂到官方市场": "List on the official market",
  "在 BscScan 看这枚": "View on BscScan",
  "协议电路": "Protocol circuit",
  "钱包": "Wallet",
  "未连接": "Not connected",
  "登录后可以退出，也可以在 BSC 和 X Layer 之间切换。创世、晶体管在 BSC，OKB 兑换在 X Layer。": "After login you can log out or switch between BSC and X Layer. Genesis and transistors are on BSC. OKB swaps are on X Layer.",
  "浏览器钱包": "Browser wallet",
  "币安钱包": "Binance Wallet",
  "挂单价（OKB）": "List price (OKB)",
  "在本站挂出": "List here",
  "在本站成交": "Buy here",
  "MINT 成功": "Minted",
  "恭喜，这枚已经属于你。": "It is yours.",
  "收下": "Done",
  "输入编号": "Token ID",
  "搜地址或编号": "Search address or ID",
  "例如 7001": "e.g. 7001",
  "类型": "Type",
  "稀有度": "Rarity",
  "衬底": "Substrate",
  "金属层": "Metal",
  "对准": "Align",
  "键合": "Bond",
  "封装": "Package",
  "属性": "Trait",
  "取值": "Value",
  "存世": "Supply",
  "占比": "Share",
  "持有人": "Holder",
  "你": "You",
  "TapeOut 协议创始人": "TapeOut founder",
  "火星人": "Martian",
  "TAPE NFT 官方": "TAPE NFT official",
  "没有挂单": "Not listed",
  "下一张铸造": "Next to mint",
  "这个属性下还没有挂单。": "No listings with these traits.",
  "没有符合这些属性的电路朋克。": "No Circuit Punk matches these traits.",
  "全部属性": "All traits",
  "点编号填进上面，再点挂出。": "Tap an ID to fill it in, then list.",
  "这个钱包还没有可挂的电路朋克。": "This wallet has no Circuit Punk to list.",
  "这个地址还没有电路朋克。": "This address has no Circuit Punk.",
  "先连接钱包，再点你持有的编号。": "Connect a wallet, then tap an ID you hold.",
  "正在准备挂单。": "Preparing the listing.",
  "等钱包确认这笔挂单。": "Confirm the listing in the wallet.",
  "先点你持有的编号。": "Tap an ID you hold first.",
  "这张不在当前钱包里。": "This token is not in the connected wallet.",
  "价格至少 0.0001 BEM，或 0.1 TAPE。": "Minimum price is 0.0001 BEM, or 0.1 TAPE.",
  "先批准 BEM 和 TAPE，再买。": "Approve BEM and TAPE, then buy.",
  "已经撤单。": "Listing cancelled.",
  "状态": "Status",
  "已收盘": "Closed",
  "已公开铸出": "Public minted",
  "还剩": "Left",
  "还没有人挂单。": "No listings yet.",
  "还没有可看的物品。": "Nothing to show yet.",
  "电路朋克这次没读到，没有写成 0。": "Circuit Punk did not load. It was not shown as zero.",
  "持有地址这次没读完。刷新后再对一次。": "Holders did not finish loading. Refresh to try again.",
  "电路朋克，符号 CPUNK，是本站的创世 NFT，也是向中本聪的一揖。它是第一款电路朋克，也只此一套。合约 0xB5ac1dddc158a639D4499aad2d8F393989D4bD34。总量一万，预留七千，公开三千，公开价锁在 1 TAPE 加 0.001 BEM。TapeCode 一号火星人 @bitcoin2themars 领 51–150。8855 号、TapeOut 创始人 @Blonskr 领 1–50。还没领出的 1611 张，370–999 和 6020–7000，留给基金会以后的新计划。图片地址已经写死。改名就不是这一款。本站不再另开第二套。TapeOut 上已经流片的创世电路仍走官网市场，不是这一款。": "Circuit Punk, symbol CPUNK, is this site's genesis NFT and a bow to Satoshi. It is the first Circuit Punk and the only one. Contract 0xB5ac1dddc158a639D4499aad2d8F393989D4bD34. Supply 10,000, reserve 7,000, public 3,000, price locked at 1 TAPE plus 0.001 BEM. TapeCode #1, the Martian @bitcoin2themars, holds 51–150. #8855, TapeOut founder @Blonskr, holds 1–50. The unclaimed 1,611, IDs 370–999 and 6020–7000, stay with the foundation for a later plan. Image URLs are fixed. A rename would be a different drop. This site will not open a second set. Genesis circuits already taped out on TapeOut still trade on the official market. They are not this drop.",
  "公开价锁定 1 TAPE 对 0.001 BEM。倍数只能是整数，价格按这个比例放大，不能单独改一边。也可以改用 OKB 或只用 BEM 发射：单位锁死，同样只能填整数倍数。用哪种代币发射，公开铸造和二级交易就只用哪种。预留从总量里划出，不参与公开铸造，不能超过总量。单人最多铸造 10 次。总量由项目方自定。创建时按总量批量生成芯片属性和稀有度，同一项目里属性组合不重复。图片可以自己上传，也可以用自己的 Key 或平台默认生成，风格分朋克和真实。": "The public price is locked at 1 TAPE to 0.001 BEM. The multiple must be an integer and scales both sides. One side cannot be changed alone. A drop can instead use OKB, or BEM only. The unit is then locked, and only an integer multiple is allowed. Public mint and secondary sales use only that token. Reserve is taken from supply, is not publicly mintable, and cannot exceed supply. A wallet can mint at most 10 times. Supply is chosen by the project. Traits and rarity are generated for the whole supply at creation, with no repeated combo. Art can be uploaded, generated with your key, or generated by the platform, punk or photo.",
  "每枚 NFT 按 TAP-721 草案，除图片外还带一份 tapnet 网表和 SHA-256，来源可以对照。标准还在社区审核，这里只出可核验的预览，不假装已经流片上链。": "Each NFT follows the TAP-721 draft. Besides the image it carries a tapnet netlist and a SHA-256, so the source can be checked. The standard is still in community review. This is a verifiable preview, not a claim that it has taped out on-chain.",
  "发射前，项目方必须先放入价值 3 美元的 OKB，这笔进金库。创建另付 1 TAPE + 0.01 枚发射代币：1 TAPE 直接销毁，0.01 锁进该项目金库。OKB 发射锁的是 0.01 OKB，BEM 或 TAPE 对发射锁的是 0.01 BEM。": "Before launch the project must deposit OKB worth 3 dollars. It goes to the vault. Creating also costs 1 TAPE plus 0.01 of the launch token. The 1 TAPE is burned. The 0.01 is locked in that project's vault. An OKB launch locks 0.01 OKB. A BEM or TAPE-pair launch locks 0.01 BEM.",
  "铸造收进来的，是这次发射的那种代币，创建时就分成三份。30% 在售罄收盘后项目方可以领取。40% 没有提取函数。收盘后，本合约里低于铸造价 2 倍、挂满 1 天的 NFT，可以被这 40% 买下并销毁。收盘时把这 40% 记成基数。每天最多花掉基数的九十分之一，当天没花完也不结转。90 天都有人来买，这 40% 可以花完，一天花不空。一天的上限小于一张合格挂单时，这张单就买不了。项目方自己的地址不能卖给它。进金库的 OKB 种子和锁进去的 0.01 不参与回购。另一个地址仍可能慢慢卖，所以一天封顶。": "Mint proceeds are the launch token, split in three at creation. 30% can be claimed by the project after the sale closes. 40% has no withdraw function. After close, an NFT listed here below 2× mint for a full day can be bought with that 40% and burned. At close, that 40% is the base. Each day can spend at most one-ninetieth of the base. Unused budget does not roll over. If buyers come all 90 days, the 40% can be spent out, but never in one day. If a day's cap is smaller than one qualifying listing, that listing cannot be bought. The project's own address cannot sell into it. The OKB seed and the locked 0.01 are not used for buyback. Another address could still sell slowly, which is why the day is capped.",
  "最后 30% 不是按天发。售罄满 90 天，并且连续 3 天都有不低于 2 倍、已经挂满 1 天的挂单，同时没有低于 2 倍的挂单，项目方一次领完。满 90 天之后连续 3 天做不到，这份钱永久不能领。之后任何人可以调用 tick：记成一天、烧掉当天那一份，或买下一张低于两倍的单，调用者拿这次支出的 5%，从当天九十分之一里出。当天预算用完就不再付。网页不保管私钥。账上的 BEM 或 TAPE 直接销毁；OKB 则一半买 BEM、一半买 TAPE，买到就销毁，直到花完。两倍看的是本合约挂单，不是同一笔交易里的现货价。别人若连续三天挂一张回购当天买不掉的低价单，这 30% 会被判负。": "The last 30% is not paid daily. Ninety days after selling out, if listings at or above 2× have been up for a full day on three days in a row, and none are below 2×, the project claims it all at once. If those three days never happen after day 90, that balance can never be claimed. Anyone may then call tick: mark a day, burn that day's share, or buy one listing below 2×. The caller receives 5% of that spend, taken from the day's ninetieth. Nothing is paid once the day's budget is gone. This site does not hold a private key. BEM or TAPE in the account is burned directly. OKB buys half BEM and half TAPE, and whatever is bought is burned, until the balance is gone. The 2× test uses listings on this contract, not a spot price inside the same transaction. If someone lists a low offer the buyback cannot fill for three days running, this 30% is forfeited.",
  "本站二级成交收 0.2%。平台那一半给收费地址。TAPE、BEM 或 OKB 的另一半留在这个项目合约里，没有提取函数，也不在成交当中拿去买别的币。这份已部署的字节码不会把 TAPE 那一半转进销毁地址。OKX 和 tapeout.net 上的成交不经过这份合约。创建调用已部署的工厂，会扣进金库的 OKB。": "Secondary sales on this site take 0.2%. Half of that goes to the fee address. The other half of the TAPE, BEM, or OKB stays in the project contract, with no withdraw function, and is not used mid-trade to buy another token. This deployed bytecode does not send the TAPE half to a burn address. Trades on OKX and tapeout.net do not pass through this contract. Creating a project calls the deployed factory and deposits the OKB into the vault.",
};

const LINES: [RegExp, string][] = [
  [/^#(\d+) 已挂出。在「挂单」里，排在市场最前。$/, "#$1 is listed, at the front of the market."],
  [/^你挂着 (\d+) 张。点撤单即可取消。$/, "$1 of yours are listed. Tap cancel to take one down."],
  [/^还没有读到挂单。合约里托管的会补进来。$/, "No listings read yet. Escrowed tokens will fill in."],
  [/^在售 (\d+) 张排在最前，后面是(.+)，(.+)。$/, "$1 for sale first, then $2, $3."],
  [/^钱包里 (\d+) 张。另有 (\d+) 张挂单中。$/, "$1 in the wallet. $2 listed."],
  [/^钱包里 (\d+) 张。$/, "$1 in the wallet."],
  [/^持有 (\d+) 张，正在核对编号 (\d+)\/(\d+)。$/, "Holding $1. Checking IDs $2/$3."],
  [/^持有 (\d+) 张。$/, "Holding $1."],
  [/^另有 (\d+) 张挂单中。$/, "$1 listed."],
  [/^挂单中 (.+)。市场的「挂单」里能看到。$/, "Listed $1. They show under Listings."],
  [/^已填入 #(\d+)。填好价格再点挂出。$/, "#$1 filled in. Set a price, then list."],
  [/^#(\d+) 挂单中$/, "#$1 listed"],
  [/^稀有度 (.+)，一万张里排第 (\d+)。最稀有的是(.+)「(.+)」，存世 (\d+) 张，占 (.+)%。$/, "Rarity $1, rank $2 of 10,000. Rarest trait is $3 “$4”, $5 exist, $6%."],
  [/^持有 (.+)$/, "Held by $1"],
  [/^这张还没铸出。$/, "This one is not minted yet."],
  [/^买下付 (.+) BEM 和 (.+) TAPE$/, "Buy for $1 BEM and $2 TAPE"],
  [/^付 (.+) BEM \+ (.+) TAPE$/, "Pay $1 BEM + $2 TAPE"],
  [/^在售 (.+) BEM \+ (.+) TAPE$/, "For sale $1 BEM + $2 TAPE"],
  [/^挂出 #(\d+) · (.+) BEM \+ (.+) TAPE · (.+)$/, "Listed #$1 · $2 BEM + $3 TAPE · $4"],
  [/^买下 #(\d+) · (.+) BEM \+ (.+) TAPE · (.+)$/, "Bought #$1 · $2 BEM + $3 TAPE · $4"],
  [/^撤单 #(\d+)$/, "Cancelled #$1"],
  [/^铸造 #(\d+) → (.+)$/, "Minted #$1 → $2"],
  [/^恭喜，电路朋克 #(\d+) 属于你了。$/, "Circuit Punk #$1 is yours."],
  [/^已核对 (\d+) \/ (\d+) 张。三个标注地址里已出现 (\d+) 个。$/, "Checked $1 / $2. $3 of the labeled addresses have appeared."],
  [/^共 (\d+) 个持有地址。每页 30 个，创始人、火星人、官方在最前。$/, "$1 holders. 30 per page. Founder, Martian, and official come first."],
  [/^正在核对 (\d+) 张的持有地址。$/, "Checking holders for $1 tokens."],
  [/^没选属性时，按稀有度从高到低排。$/, "No trait selected. Rarest first."],
  [/^只看挂单，现在 (\d+) 张。$/, "Listings only, $1 now."],
  [/^按属性筛中 (\d+) 张，稀有的在前。$/, "$1 match these traits, rarest first."],
  [/^正在看物品。$/, "Browsing items."],
  [/^只看挂单。$/, "Listings only."],
  [/^稀有的在前$/, "rarest first"],
  [/^稀有的在后$/, "rarest last"],
  [/^按编号排$/, "by ID"],
  [/^全部$/, "all"],
];

const GLOSS: [string, string][] = [
  ["极紫外晶粒", "EUV die"],
  ["键合巨像", "Bond colossus"],
  ["报废晶粒", "Scrap die"],
  ["晶圆人像", "Wafer portrait"],
  ["吉祥晶粒", "Mascot die"],
  ["对准标记", "Align mark"],
  ["缺陷图样", "Defect pattern"],
  ["纪念版图", "Memorial layout"],
  ["轻掺杂硅", "Lightly doped Si"],
  ["中掺杂硅", "Medium doped Si"],
  ["重掺杂硅", "Heavily doped Si"],
  ["本征硅", "Intrinsic Si"],
  ["氧化层", "Oxide"],
  ["氮化镓", "GaN"],
  ["碳化硅", "SiC"],
  ["极紫外", "EUV"],
  ["报废硅", "Scrap Si"],
  ["厚铜", "Thick copper"],
  ["无金属", "No metal"],
  ["铝互连", "Aluminum"],
  ["铜互连", "Copper"],
  ["金互连", "Gold"],
  ["钴盖帽", "Cobalt cap"],
  ["紫光刻胶", "Purple resist"],
  ["钨栓塞", "Tungsten plug"],
  ["绿胶", "Green resist"],
  ["高顶盖帽", "Tall cap"],
  ["键合点", "Bond pad"],
  ["遮光层", "Shutter"],
  ["经典遮光", "Classic shutter"],
  ["牛角框", "Horn rim"],
  ["眼罩", "Eye patch"],
  ["三维眼镜", "3D glasses"],
  ["激光对准", "Laser align"],
  ["钝化", "Passivation"],
  ["引线", "Wire"],
  ["探针", "Probe"],
  ["针孔", "Pinhole"],
  ["金属胡须", "Metal whisker"],
  ["开槽", "Groove"],
  ["金凸点", "Gold bump"],
  ["崩边", "Chipped edge"],
  ["裸片", "Bare die"],
  ["陶瓷盖", "Ceramic lid"],
  ["传说", "Legendary"],
  ["史诗", "Epic"],
  ["稀有度", "Rarity"],
  ["稀有", "Rare"],
  ["少见", "Uncommon"],
  ["普通", "Common"],
  ["电路朋克", "Circuit Punk"],
  ["正在铸造", "Minting"],
  ["未挂单", "Not listed"],
  ["挂单中", "Listed"],
  ["下一张铸造", "Next to mint"],
  ["没有挂单", "Not listed"],
  ["类型", "Type"],
  ["衬底", "Substrate"],
  ["金属层", "Metal"],
  ["对准", "Align"],
  ["键合", "Bond"],
  ["封装", "Package"],
  ["持有人", "Holder"],
  ["创始人", "Founder"],
  ["火星人", "Martian"],
  ["官方", "Official"],
  ["挂单", "listing"],
  ["成交", "sale"],
  ["铸造", "mint"],
  ["钱包", "wallet"],
  ["属性", "trait"],
  ["编号", "ID"],
  ["张", ""],
  ["第 ", "rank "],
];

const originals = new WeakMap<Text, string>();
const attrOriginal = new WeakMap<Element, Record<string, string>>();
let applying = false;

export function englishOf(text: string): string {
  const trim = text.trim();
  if (!trim) return text;
  if (EXACT[trim]) return text.replace(trim, EXACT[trim]);
  for (const [re, next] of LINES) {
    if (re.test(trim)) return text.replace(trim, trim.replace(re, next));
  }
  let out = text;
  for (const [zh, en] of GLOSS) out = out.split(zh).join(en);
  return out;
}

const toEn = englishOf;

function renderText(node: Text) {
  const current = node.nodeValue ?? "";
  const saved = originals.get(node);
  if (saved != null && current !== saved && current !== toEn(saved)) originals.delete(node);
  if (uiLang() === "zh") {
    const zh = originals.get(node);
    if (zh && current === toEn(zh)) node.nodeValue = zh;
    return;
  }
  const source = originals.get(node) ?? current;
  if (!/[\u4e00-\u9fff]/.test(source)) return;
  originals.set(node, source);
  const next = toEn(source);
  if (next !== current) node.nodeValue = next;
}

function renderAttrs(el: Element) {
  const names = ["placeholder", "aria-label", "title", "alt"] as const;
  let saved = attrOriginal.get(el);
  if (uiLang() === "zh") {
    if (!saved) return;
    for (const name of names) {
      if (saved[name] != null) el.setAttribute(name, saved[name]);
    }
    return;
  }
  if (!saved) saved = {};
  for (const name of names) {
    const value = el.getAttribute(name);
    if (value == null) continue;
    if (saved[name] == null) {
      if (!/[\u4e00-\u9fff]/.test(value)) continue;
      saved[name] = value;
    }
    const next = toEn(saved[name]);
    if (next !== value) el.setAttribute(name, next);
  }
  if (Object.keys(saved).length) attrOriginal.set(el, saved);
}

export function localize(root: ParentNode) {
  if (applying) return;
  applying = true;
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = (node as Text).parentElement;
      if (parent && !parent.closest("script, style")) renderText(node as Text);
      node = walker.nextNode();
    }
    if (root instanceof Element) renderAttrs(root);
    root.querySelectorAll<Element>("[placeholder],[aria-label],[title],[alt]").forEach(renderAttrs);
  } finally {
    applying = false;
  }
}

export function watchEnglish(root: HTMLElement): () => void {
  let timer = 0;
  const pending = new Set<Node>();
  const flush = () => {
    timer = 0;
    if (uiLang() !== "en") {
      pending.clear();
      return;
    }
    const nodes = [...pending];
    pending.clear();
    if (applying) return;
    applying = true;
    try {
      for (const node of nodes) {
        if (!node.isConnected && node !== root) continue;
        if (node.nodeType === Node.TEXT_NODE) renderText(node as Text);
        else if (node instanceof Element) {
          renderAttrs(node);
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let child = walker.nextNode();
          while (child) {
            renderText(child as Text);
            child = walker.nextNode();
          }
        }
      }
    } finally {
      applying = false;
    }
  };
  const obs = new MutationObserver((records) => {
    if (applying || uiLang() !== "en") return;
    for (const record of records) {
      if (record.type === "characterData" && record.target.nodeType === Node.TEXT_NODE) pending.add(record.target);
      for (const added of record.addedNodes) pending.add(added);
      if (record.type === "attributes" && record.target instanceof Element) pending.add(record.target);
    }
    if (!timer) timer = window.setTimeout(flush, 40);
  });
  obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "aria-label", "title", "alt"] });
  const stopLang = onLang(() => localize(root));
  localize(root);
  return () => {
    obs.disconnect();
    stopLang();
    if (timer) window.clearTimeout(timer);
  };
}
