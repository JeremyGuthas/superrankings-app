import { useEffect, useState } from 'react';
import './App.css';

function App() {
  // --- CONFIGURATION ---
  // HARDCODED to ensure no mistakes
  const API_BASE = "https://superrankings-app.onrender.com"; 

  // --- STATE ---
  const [view, setView] = useState('table'); 
  const [rankings, setRankings] = useState([]);
  const [availableWeeks, setAvailableWeeks] = useState([]);
  const [currentViewWeek, setCurrentViewWeek] = useState(1); 

  const [isAdmin, setIsAdmin] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [adminToken, setAdminToken] = useState(''); 
  
  const [teams, setTeams] = useState([]);
  const [sources, setSources] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedWeek, setSelectedWeek] = useState(12);
  const [inputRanks, setInputRanks] = useState({});
  
  const [outlierMap, setOutlierMap] = useState({}); 

  useEffect(() => {
    // This log helps debugging on the iPad
    console.log("Connecting to API:", API_BASE);
    
    fetchDropdowns();
    fetchWeeks(); 
    fetchRankings(currentViewWeek);
  }, []);

  useEffect(() => {
    if (currentViewWeek) fetchRankings(currentViewWeek);
  }, [currentViewWeek]);

  useEffect(() => {
    if (view === 'admin') fetchRankings(selectedWeek);
  }, [selectedWeek, view]);

  useEffect(() => {
    if (view === 'admin' && selectedTeam && selectedWeek) {
      fetchExistingRankings(selectedTeam, selectedWeek);
    } else {
        setInputRanks({});
        setOutlierMap({});
    }
  }, [selectedTeam, selectedWeek, view, rankings]); 

  const fetchRankings = (week) => {
    fetch(`${API_BASE}/rankings?week=${week}`)
      .then(res => res.json())
      .then(data => setRankings(data))
      .catch(err => console.error("Failed to load rankings:", err));
  };

  const fetchWeeks = () => {
    fetch(`${API_BASE}/weeks`)
      .then(res => res.json())
      .then(data => {
        setAvailableWeeks(data);
        if (data.length > 0 && currentViewWeek === 1) {
            setCurrentViewWeek(Math.max(...data)); 
        }
      });
  };

  const fetchDropdowns = () => {
    fetch(`${API_BASE}/teams`).then(res => res.json()).then(setTeams);
    fetch(`${API_BASE}/sources`).then(res => res.json()).then(setSources);
  };

  const fetchExistingRankings = (teamId, weekNum) => {
      const teamData = rankings.find(t => t.name === teams.find(tm => tm.id === parseInt(teamId))?.name);
      
      const newInputs = {};
      const newOutliers = {};

      if (teamData && teamData.source_ranks) {
        teamData.source_ranks.forEach(rank => {
            const source = sources.find(s => s.name === rank.source);
            if (source) {
                newInputs[source.id] = rank.rank;
                if (rank.is_outlier) {
                    newOutliers[source.id] = rank.id; 
                }
            }
        });
      }
      setInputRanks(newInputs);
      setOutlierMap(newOutliers);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: passwordInput })
        });

        if (res.ok) {
            setIsAdmin(true);
            setAdminToken(passwordInput); 
            setView('admin'); 
            setPasswordInput('');
            setSelectedWeek(currentViewWeek); 
        } else {
            alert("Wrong Password!");
        }
    } catch (err) {
        alert("Server Error: Is the backend running?");
    }
  };

  const handleAdminClick = () => {
    if (view === 'table') {
      isAdmin ? setView('admin') : setView('login');
    } else {
      setView('table');
      fetchRankings(currentViewWeek); 
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const ranksToSend = sources.map(source => ({
      source_id: source.id,
      value: inputRanks[source.id] ? parseInt(inputRanks[source.id]) : null
    })).filter(r => r.value !== null); 

    const response = await fetch(`${API_BASE}/submit-rankings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        team_id: parseInt(selectedTeam),
        week: parseInt(selectedWeek),
        ranks: ranksToSend,
        password: adminToken 
      })
    });

    if (response.ok) {
      fetchRankings(selectedWeek); 
      alert("Saved!"); 
    } else {
      alert("Error: Unauthorized or Server Issue");
    }
  };

  const handleApprove = async (sourceId, rankingId) => {
      const response = await fetch(`${API_BASE}/approve-outlier`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
              ranking_id: rankingId,
              password: adminToken 
          })
      });

      if (response.ok) {
          fetchRankings(selectedWeek); 
      } else {
          alert("Failed to approve (Unauthorized).");
      }
  };

  const handleInputChange = (sourceId, value) => {
    setInputRanks(prev => ({ ...prev, [sourceId]: value }));
  };

  const teamsWithAlerts = rankings.filter(t => 
      t.source_ranks && t.source_ranks.some(r => r.is_outlier)
  );

  return (
    <div className="app-container">
      <header>
        <h1>NFL Consensus Power Rankings (v3)</h1>
        <button onClick={handleAdminClick}>
          {view === 'table' ? 'Admin Login' : 'Back to Table'}
        </button>
      </header>

      {view === 'table' && (
        <>
          <div className="week-tabs">
              {availableWeeks.map(week => (
                  <button 
                      key={week}
                      onClick={() => setCurrentViewWeek(week)}
                      className={currentViewWeek === week ? 'tab active' : 'tab'}
                  >
                      Week {week}
                  </button>
              ))}
          </div>

          <div className="table-wrapper">
            {rankings.length === 0 ? (
              <p style={{textAlign:'center', padding:'20px'}}>Loading Rankings...</p>
            ) : (
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Team</th>
                  <th>Avg Rank</th>
                  <th>Source Breakdown</th>
                </tr>
              </thead>
              <tbody>
                {rankings.map((team, index) => (
                  <tr key={index}>
                    {/* Clean the Rank (Remove ## or #) */}
                    <td className="rank-num">
                      #{team.rank_num ? team.rank_num.toString().replace(/#/g, '') : index + 1}
                    </td>
                    
                    <td className="team-cell">
                      <img src={team.logo_url} alt={team.name} width="40" />
                      {/* Added class for Mobile CSS to grab */}
                      <span className="team-name-text">{team.name}</span>
                    </td>
                    
                    <td className="score-cell">{team.consensus_score}</td>
                    
                    <td className="source-tags">
                      {team.source_ranks && team.source_ranks.map((s, i) => (
                        <div 
                          key={i} 
                          className="tag"
                          style={{
                            backgroundColor: s.is_outlier ? '#fee2e2' : '#e5e7eb',
                            color: s.is_outlier ? '#991b1b' : '#4b5563',
                            border: s.is_outlier ? '1px solid #ef4444' : '1px solid transparent'
                          }}
                          title={s.is_outlier ? "Outlier Detected" : ""}
                        >
                          {s.source}: <strong>{s.rank}</strong>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        </>
      )}

      {view === 'login' && (
        <div className="login-box">
          <h2>Admin Access</h2>
          <form onSubmit={handleLogin}>
            <input 
              type="password" 
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Password"
              className="login-input"
            />
            <button type="submit" className="login-btn">Unlock</button>
          </form>
        </div>
      )}

      {view === 'admin' && (
        <div className="admin-panel">
          
          <div className="alerts-section">
             <h3>⚠️ Outlier Review (Week {selectedWeek})</h3>
             {teamsWithAlerts.length === 0 ? (
                 <p className="no-alerts">✅ No outliers detected for this week.</p>
             ) : (
                 <div className="team-chips">
                     {teamsWithAlerts.map(t => (
                         <button 
                            key={t.id} 
                            onClick={() => setSelectedTeam(t.id.toString())} 
                            className={`chip ${parseInt(selectedTeam) === t.id ? 'active-chip' : ''}`}
                         >
                            {t.name}
                         </button>
                     ))}
                 </div>
             )}
          </div>

          <hr className="divider"/>

          <h2>Edit Rankings</h2>
          
          <form onSubmit={handleSubmit} className="edit-form">
            <div className="form-row">
                <div style={{flex:1}}>
                    <label><strong>Select Week:</strong></label>
                    <input 
                        type="number" 
                        value={selectedWeek} 
                        onChange={e => setSelectedWeek(e.target.value)} 
                        className="form-input"
                    />
                </div>
                <div style={{flex:2}}>
                    <label><strong>Select Team:</strong></label>
                    <select 
                        value={selectedTeam} 
                        onChange={e => setSelectedTeam(e.target.value)}
                        className="form-input"
                        required
                    >
                        <option value="">-- Choose a Team --</option>
                        {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                </div>
            </div>

            {selectedTeam && (
                <div className="rank-inputs-container">
                    <h3 style={{marginTop:'20px', marginBottom:'10px'}}>
                        Current Rankings for {teams.find(t => t.id === parseInt(selectedTeam))?.name}:
                    </h3>
                    <div className="rank-grid">
                    {sources.map(source => (
                        <div 
                            key={source.id} 
                            className={`rank-input-group ${outlierMap[source.id] ? 'outlier-input' : ''}`}
                        >
                        <label>{source.name}:</label>
                        <input 
                            type="number" 
                            placeholder="-"
                            value={inputRanks[source.id] || ''}
                            onChange={(e) => handleInputChange(source.id, e.target.value)}
                        />
                        
                        {outlierMap[source.id] && (
                            <button 
                                type="button" 
                                className="approve-btn"
                                onClick={() => handleApprove(source.id, outlierMap[source.id])}
                                title="Approve this outlier (ignore it)"
                            >
                                ✅
                            </button>
                        )}
                        </div>
                    ))}
                    </div>

                    <button type="submit" className="save-btn">
                        Save Rankings
                    </button>
                </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

export default App;